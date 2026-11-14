//! The tag reader for JavaScript: a plain C ABI with no imports, no glue code and no
//! wasm-bindgen (`web/src/lib/vuio.ts` is the JavaScript side). `npm run build:wasm` builds it.
//!
//! The caller reads the file a range at a time, so a large file is never loaded whole:
//!
//! ```text
//! vmi_begin(fileSize)
//! for each range to supply (say the first 256 KB and the last 128 KB):
//!     ptr = vmi_range(offset, length)      // Rust allocates; copy the file's bytes there
//! loop:
//!     switch vmi_inspect():
//!         0: JSON at vmi_result_ptr() / vmi_result_len()  -> done
//!         1: error message at the same place              -> done
//!         2: read vmi_need_len() bytes at vmi_need_offset() into a new vmi_range(); again
//! vmi_end()                                // frees the ranges and the result
//! ```
//!
//! Sizes and offsets are `u64` (`BigInt` in JavaScript); pointers and lengths are `usize`.
//! A Rust panic aborts with a WebAssembly trap: discard the instance and make a new one.

use crate::{MediaInfoError, Source, inspect_source};
use std::cell::RefCell;

/// Bumped when the exported functions change.
const ABI_VERSION: u32 = 1;

#[derive(Default)]
struct State {
    size: u64,
    ranges: Vec<(u64, Box<[u8]>)>,
    result: String,
    need: (u64, u64),
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

#[unsafe(no_mangle)]
pub extern "C" fn vmi_abi_version() -> u32 {
    ABI_VERSION
}

/// Starts a file of `size` bytes, dropping anything left from the last one.
#[unsafe(no_mangle)]
pub extern "C" fn vmi_begin(size: u64) {
    STATE.with(|s| {
        *s.borrow_mut() = State {
            size,
            ..State::default()
        }
    });
}

/// A `len`-byte buffer for the file's bytes from `offset`, for the caller to fill before the
/// next `vmi_inspect`. It stays valid until `vmi_begin` or `vmi_end`.
#[unsafe(no_mangle)]
pub extern "C" fn vmi_range(offset: u64, len: usize) -> *mut u8 {
    STATE.with(|s| {
        let mut buffer = vec![0u8; len].into_boxed_slice();
        let ptr = buffer.as_mut_ptr();
        s.borrow_mut().ranges.push((offset, buffer));
        ptr
    })
}

/// Inspects what has been supplied: 0 = JSON in the result, 1 = an error message in the
/// result, 2 = more bytes needed (see `vmi_need_offset` / `vmi_need_len`).
#[unsafe(no_mangle)]
pub extern "C" fn vmi_inspect() -> i32 {
    STATE.with(|s| {
        let mut state = s.borrow_mut();
        let ranges = state
            .ranges
            .iter()
            .map(|(offset, bytes)| (*offset, &bytes[..]))
            .collect();
        let source = Source::sparse(state.size, ranges);
        let outcome = inspect_source(&source).and_then(|report| report.to_json());
        match outcome {
            Ok(json) => {
                state.result = json;
                0
            }
            Err(MediaInfoError::NeedMore { offset, len }) => {
                state.need = (offset, len);
                2
            }
            Err(e) => {
                state.result = e.to_string();
                1
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vmi_need_offset() -> u64 {
    STATE.with(|s| s.borrow().need.0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vmi_need_len() -> u64 {
    STATE.with(|s| s.borrow().need.1)
}

/// The UTF-8 result of the last `vmi_inspect` (JSON, or an error message).
#[unsafe(no_mangle)]
pub extern "C" fn vmi_result_ptr() -> *const u8 {
    STATE.with(|s| s.borrow().result.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn vmi_result_len() -> usize {
    STATE.with(|s| s.borrow().result.len())
}

/// Frees the file's ranges and the result.
#[unsafe(no_mangle)]
pub extern "C" fn vmi_end() {
    STATE.with(|s| *s.borrow_mut() = State::default());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result() -> String {
        let (ptr, len) = (vmi_result_ptr(), vmi_result_len());
        // SAFETY: the result string outlives this read; nothing else touches the state.
        String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(ptr, len) }).into_owned()
    }

    fn supply(file: &[u8], offset: u64, len: u64) {
        let end = (offset + len).min(file.len() as u64) as usize;
        let bytes = &file[offset as usize..end];
        let ptr = vmi_range(offset, bytes.len());
        // SAFETY: vmi_range returned a buffer of exactly bytes.len() bytes.
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len()) };
    }

    /// An MP3 whose ID3v2 tag is bigger than the head the caller starts with: the module asks
    /// for the rest, then answers.
    #[test]
    fn asks_for_what_it_needs_then_answers() {
        let mut file = Vec::new();
        let mut frame = [0u8; 1 + 10];
        frame[1..].copy_from_slice(b"Long Title");
        let picture = vec![0u8; 300_000];
        let mut body = Vec::new();
        for (id, data) in [(&b"TIT2"[..], &frame[..]), (&b"APIC"[..], &picture[..])] {
            body.extend_from_slice(id);
            body.extend_from_slice(&(data.len() as u32).to_be_bytes());
            body.extend_from_slice(&[0, 0]);
            body.extend_from_slice(data);
        }
        let n = body.len() as u32;
        file.extend_from_slice(b"ID3\x03\x00\x00");
        file.extend_from_slice(&[
            (n >> 21) as u8 & 0x7F,
            (n >> 14) as u8 & 0x7F,
            (n >> 7) as u8 & 0x7F,
            n as u8 & 0x7F,
        ]);
        file.extend_from_slice(&body);
        // Two 128 kb/s MPEG-1 Layer III frames (417 bytes each at 44.1 kHz).
        for _ in 0..2 {
            let mut f = vec![0u8; 417];
            f[..4].copy_from_slice(&[0xFF, 0xFB, 0x90, 0x00]);
            file.extend_from_slice(&f);
        }

        vmi_begin(file.len() as u64);
        supply(&file, 0, 64 * 1024);
        supply(&file, file.len() as u64 - 4096, 4096);
        let mut rounds = 0;
        let code = loop {
            match vmi_inspect() {
                2 => {
                    rounds += 1;
                    assert!(rounds < 8, "too many rounds");
                    supply(&file, vmi_need_offset(), vmi_need_len());
                }
                code => break code,
            }
        };
        assert_eq!(code, 0, "{}", result());
        assert!(rounds >= 1);
        let json = result();
        assert!(json.contains("\"Title\": \"Long Title\""), "{json}");
        assert!(json.contains("\"SamplingRate\": \"44100\""), "{json}");
        vmi_end();
        assert_eq!(vmi_result_len(), 0);
    }

    #[test]
    fn reports_errors_as_text() {
        let file = b"definitely not a media file";
        vmi_begin(file.len() as u64);
        supply(file, 0, file.len() as u64);
        assert_eq!(vmi_inspect(), 1);
        assert!(result().contains("Unrecognized"));
        vmi_end();
    }
}
