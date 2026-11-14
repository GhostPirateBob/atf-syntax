//! APEv1 / APEv2 tags, at the end of Monkey's Audio, WavPack, Musepack and some MP3 files.

use super::{push_named, push_position};
use crate::core::{error::Result, models::TagSet, source::Source};

/// Reads the APE tag that ends at `end` (the end of the file, or where an ID3v1 tag starts),
/// if there is one. Returns the offset the tag starts at, so the audio before it can be measured.
pub fn read(src: &Source, end: u64, set: &mut TagSet) -> Result<Option<u64>> {
    if end < 32 {
        return Ok(None);
    }
    let footer = src.need(end - 32, 32)?;
    if footer.len() < 32 || &footer[..8] != b"APETAGEX" {
        return Ok(None);
    }
    let le =
        |i: usize| u32::from_le_bytes([footer[i], footer[i + 1], footer[i + 2], footer[i + 3]]);
    let tag_size = le(12) as u64; // items + footer, not the optional header
    let item_count = le(16);
    let has_header = le(20) & 0x8000_0000 != 0;
    if tag_size < 32 || tag_size > end {
        return Ok(None);
    }
    let items_start = end - tag_size;
    let items = src.need(items_start, tag_size - 32)?;
    parse_items(items, item_count, set);
    let start = if has_header {
        items_start.saturating_sub(32)
    } else {
        items_start
    };
    Ok(Some(start))
}

fn parse_items(data: &[u8], count: u32, set: &mut TagSet) {
    let mut pos = 0;
    for _ in 0..count {
        if pos + 8 > data.len() {
            break;
        }
        let len =
            u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        let flags =
            u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]]);
        pos += 8;
        let Some(key_len) = data[pos..].iter().position(|&b| b == 0) else {
            break;
        };
        let key = String::from_utf8_lossy(&data[pos..pos + key_len]).into_owned();
        pos += key_len + 1;
        let Some(value) = data.get(pos..pos + len) else {
            break;
        };
        pos += len;

        match (flags >> 1) & 0x03 {
            // UTF-8 text; several values are separated by NUL. Track and disc numbers are
            // split into position and total (`7/14`), as MediaInfo does for APE.
            0 => {
                let text = String::from_utf8_lossy(value);
                match key.to_ascii_lowercase().as_str() {
                    "track" | "tracknumber" => {
                        push_position(set, "Track_Position", "Track_Position_Total", &text)
                    }
                    "disc" | "discnumber" => {
                        push_position(set, "Part_Position", "Part_Position_Total", &text)
                    }
                    _ => {
                        for v in text.split('\0') {
                            push_named(set, &key, v);
                        }
                    }
                }
            }
            // Binary: only cover pictures matter here.
            1 if key.to_ascii_lowercase().starts_with("cover art") => set.set("Cover", "Yes"),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_apev2_items_at_the_end() {
        let mut data = b"audio".to_vec();
        let mut items = Vec::new();
        for (k, v) in [
            ("Title", "My Rock Song"),
            ("Artist", "Rock Band"),
            ("Album Artist", "VA"),
        ] {
            items.extend_from_slice(&(v.len() as u32).to_le_bytes());
            items.extend_from_slice(&0u32.to_le_bytes());
            items.extend_from_slice(k.as_bytes());
            items.push(0);
            items.extend_from_slice(v.as_bytes());
        }
        let tag_size = items.len() + 32;
        data.extend_from_slice(&items);
        data.extend_from_slice(b"APETAGEX");
        data.extend_from_slice(&2000u32.to_le_bytes());
        data.extend_from_slice(&(tag_size as u32).to_le_bytes());
        data.extend_from_slice(&3u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&[0u8; 8]);

        let src = Source::whole(&data);
        let mut set = TagSet::default();
        assert_eq!(read(&src, data.len() as u64, &mut set).unwrap(), Some(5));
        let get = |k: &str| set.0.get(k).map(String::as_str);
        assert_eq!(get("Title"), Some("My Rock Song"));
        assert_eq!(get("Performer"), Some("Rock Band"));
        assert_eq!(get("Album_Performer"), Some("VA"));
    }
}
