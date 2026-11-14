use crate::core::error::{MediaInfoError, Result};

/// What the parsers can see of a file: its real size and the byte ranges read from it so far.
///
/// A file loaded into memory is one range covering all of it, so every read succeeds. The wasm
/// build starts from just a head and a tail: a parser that has to have bytes outside them asks
/// with [`need`](Self::need), whose [`MediaInfoError::NeedMore`] names the range for the caller
/// to read before inspecting again. Scans that can make do with less use [`get`](Self::get) or
/// [`available`](Self::available) instead, so a large file is never read whole just to be
/// summed up.
#[derive(Debug, Clone)]
pub struct Source<'a> {
    size: u64,
    ranges: Vec<(u64, &'a [u8])>,
}

impl<'a> Source<'a> {
    /// A file held entirely in memory.
    pub fn whole(data: &'a [u8]) -> Self {
        Self {
            size: data.len() as u64,
            ranges: vec![(0, data)],
        }
    }

    /// A file of `size` bytes of which only `ranges` (offset, bytes) have been read.
    pub fn sparse(size: u64, ranges: Vec<(u64, &'a [u8])>) -> Self {
        Self { size, ranges }
    }

    /// The file's real size, whatever has been read of it.
    pub fn size(&self) -> u64 {
        self.size
    }

    /// Bytes `offset..offset + len`, cut short at the end of the file, if they have been read.
    pub fn get(&self, offset: u64, len: u64) -> Option<&'a [u8]> {
        let start = offset.min(self.size);
        let end = offset.saturating_add(len).min(self.size);
        if start == end {
            return Some(&[]);
        }
        self.ranges.iter().find_map(|&(at, bytes)| {
            let stop = at + bytes.len() as u64;
            (at <= start && end <= stop).then(|| &bytes[(start - at) as usize..(end - at) as usize])
        })
    }

    /// Like [`get`](Self::get), but bytes that have not been read are an error asking for them.
    pub fn need(&self, offset: u64, len: u64) -> Result<&'a [u8]> {
        self.get(offset, len)
            .ok_or_else(|| MediaInfoError::NeedMore {
                offset,
                len: offset.saturating_add(len).min(self.size) - offset,
            })
    }

    /// The read bytes that run on from `offset`, at most `max` of them: for scans that use
    /// whatever is there.
    pub fn available(&self, offset: u64, max: u64) -> &'a [u8] {
        for &(at, bytes) in &self.ranges {
            let stop = at + bytes.len() as u64;
            if at <= offset && offset < stop {
                let from = (offset - at) as usize;
                let to = from + max.min(stop - offset) as usize;
                return &bytes[from..to];
            }
        }
        &[]
    }

    /// The whole file, for the parsers that walk all of it.
    pub fn whole_file(&self) -> Result<&'a [u8]> {
        self.need(0, self.size)
    }

    /// The last `len` bytes of the file (or all of it, if it is shorter).
    pub fn need_tail(&self, len: u64) -> Result<&'a [u8]> {
        let start = self.size.saturating_sub(len);
        self.need(start, self.size - start)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sparse_reads_hit_or_ask() {
        let head = [1u8, 2, 3, 4];
        let tail = [9u8, 10];
        let src = Source::sparse(100, vec![(0, &head), (98, &tail)]);
        assert_eq!(src.get(1, 2), Some(&[2u8, 3][..]));
        assert_eq!(src.get(98, 10), Some(&[9u8, 10][..])); // clamped at EOF
        assert_eq!(src.get(200, 4), Some(&[][..]));
        assert!(src.get(3, 2).is_none()); // straddles the gap
        match src.need(50, 10) {
            Err(MediaInfoError::NeedMore { offset, len }) => assert_eq!((offset, len), (50, 10)),
            other => panic!("expected NeedMore, got {other:?}"),
        }
        assert_eq!(src.available(2, 100), &[3u8, 4][..]);
        assert_eq!(src.need_tail(2).unwrap(), &[9u8, 10][..]);
    }
}
