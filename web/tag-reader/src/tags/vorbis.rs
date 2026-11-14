//! Vorbis comments (FLAC, Ogg Vorbis / Opus / FLAC, and Matroska's A_VORBIS private data).

use super::push_named;
use crate::core::models::TagSet;

/// Reads a Vorbis comment block (vendor string, then `NAME=value` comments, all lengths
/// little-endian) into MediaInfo fields. Returns the vendor string: the encoder library, which
/// MediaInfo shows as the audio stream's `Encoded_Library`.
pub fn read(data: &[u8], set: &mut TagSet) -> Option<String> {
    let mut pos = 0usize;
    let next_u32 = |pos: &mut usize| -> Option<usize> {
        let b = data.get(*pos..*pos + 4)?;
        *pos += 4;
        Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
    };

    let vendor_len = next_u32(&mut pos)?;
    let vendor = String::from_utf8_lossy(data.get(pos..pos.checked_add(vendor_len)?)?)
        .trim()
        .to_string();
    pos += vendor_len;

    // A truncated block (a long cover picture cut off by a page boundary) keeps what came before.
    if let Some(count) = next_u32(&mut pos) {
        for _ in 0..count {
            let Some(len) = next_u32(&mut pos) else { break };
            let Some(comment) = pos.checked_add(len).and_then(|end| data.get(pos..end)) else {
                break;
            };
            pos += len;
            let comment = String::from_utf8_lossy(comment);
            if let Some((name, value)) = comment.split_once('=') {
                if name.eq_ignore_ascii_case("METADATA_BLOCK_PICTURE")
                    || name.eq_ignore_ascii_case("COVERART")
                {
                    set.set("Cover", "Yes");
                } else {
                    push_named(set, name, value);
                }
            }
        }
    }
    (!vendor.is_empty()).then_some(vendor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_vendor_and_comments() {
        let mut data = Vec::new();
        data.extend_from_slice(&4u32.to_le_bytes());
        data.extend_from_slice(b"test");
        let comments = [
            "TITLE=My Title",
            "ARTIST=One",
            "ARTIST=Two",
            "TRACKNUMBER=3/12",
        ];
        data.extend_from_slice(&(comments.len() as u32).to_le_bytes());
        for c in comments {
            data.extend_from_slice(&(c.len() as u32).to_le_bytes());
            data.extend_from_slice(c.as_bytes());
        }

        let mut set = TagSet::default();
        assert_eq!(read(&data, &mut set).as_deref(), Some("test"));
        let get = |k: &str| set.0.get(k).map(String::as_str);
        assert_eq!(get("Title"), Some("My Title"));
        assert_eq!(get("Performer"), Some("One / Two"));
        // Vorbis track numbers are kept as written, as MediaInfo does.
        assert_eq!(get("Track_Position"), Some("3/12"));
    }
}
