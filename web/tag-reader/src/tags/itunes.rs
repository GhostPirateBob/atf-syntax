//! iTunes-style `ilst` metadata in MP4 / M4A files.

use super::{GENRES, genre_name, push_named};
use crate::core::models::TagSet;

/// Reads the items of an `ilst` box (its payload) into MediaInfo fields.
///
/// Item types are matched as raw bytes: the `©` in `©nam` is the single byte 0xA9, which is not
/// valid UTF-8 on its own.
pub fn read(ilst: &[u8], set: &mut TagSet) {
    for (kind, item) in boxes(ilst) {
        if kind == *b"----" {
            freeform(item, set);
            continue;
        }
        let Some((type_code, value)) = boxes(item)
            .find(|(k, _)| k == b"data")
            .and_then(|(_, d)| data_atom(d))
        else {
            continue;
        };
        let text = || match type_code {
            1 => String::from_utf8_lossy(value).into_owned(),
            2 => String::from_utf16_lossy(
                &value
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect::<Vec<_>>(),
            ),
            _ => String::new(),
        };
        let field = match &kind {
            b"\xa9nam" => "Title",
            b"\xa9ART" => "Performer",
            b"aART" => "Album_Performer",
            b"\xa9alb" => "Album",
            b"\xa9wrt" => "Composer",
            b"\xa9cmt" => "Comment",
            b"\xa9day" => "Recorded_Date",
            b"\xa9too" => "Encoded_Application",
            b"\xa9enc" => "EncodedBy",
            b"\xa9grp" => "Grouping",
            b"\xa9lyr" => "Lyrics",
            b"\xa9con" => "Conductor",
            b"\xa9pub" => "Publisher",
            b"cprt" | b"\xa9cpy" => "Copyright",
            b"desc" => "Description",
            b"\xa9gen" => {
                set.push("Genre", &genre_name(&text()));
                continue;
            }
            // gnre: an ID3v1 genre number plus one.
            b"gnre" => {
                if value.len() >= 2 {
                    let n = u16::from_be_bytes([value[0], value[1]]) as usize;
                    if let Some(g) = n.checked_sub(1).and_then(|i| GENRES.get(i)) {
                        set.push("Genre", g);
                    }
                }
                continue;
            }
            // trkn / disk: reserved u16, position u16, total u16.
            b"trkn" | b"disk" => {
                let (pos_field, total_field) = if kind == *b"trkn" {
                    ("Track_Position", "Track_Position_Total")
                } else {
                    ("Part_Position", "Part_Position_Total")
                };
                if value.len() >= 4 {
                    let pos = u16::from_be_bytes([value[2], value[3]]);
                    if pos > 0 {
                        set.push(pos_field, &pos.to_string());
                    }
                }
                if value.len() >= 6 {
                    let total = u16::from_be_bytes([value[4], value[5]]);
                    if total > 0 {
                        set.push(total_field, &total.to_string());
                    }
                }
                continue;
            }
            b"tmpo" => {
                if value.len() >= 2 {
                    let bpm = u16::from_be_bytes([value[0], value[1]]);
                    if bpm > 0 {
                        set.push("BPM", &bpm.to_string());
                    }
                }
                continue;
            }
            b"covr" => {
                set.set("Cover", "Yes");
                continue;
            }
            _ => continue,
        };
        set.push(field, &text());
    }
}

/// A `----` item: `mean` (reverse-DNS owner), `name`, then `data`, e.g.
/// com.apple.iTunes / replaygain_track_gain.
fn freeform(item: &[u8], set: &mut TagSet) {
    let mut name = None;
    let mut value = None;
    for (kind, payload) in boxes(item) {
        match &kind {
            b"name" if payload.len() > 4 => {
                name = Some(String::from_utf8_lossy(&payload[4..]).into_owned())
            }
            b"data" => {
                value = data_atom(payload).map(|(_, v)| String::from_utf8_lossy(v).into_owned())
            }
            _ => {}
        }
    }
    if let (Some(name), Some(value)) = (name, value) {
        push_named(set, &name, &value);
    }
}

/// A `data` atom's payload: type (4 bytes), locale (4 bytes), value.
fn data_atom(payload: &[u8]) -> Option<(u32, &[u8])> {
    let type_code = u32::from_be_bytes(payload.get(..4)?.try_into().ok()?) & 0x00FF_FFFF;
    Some((type_code, payload.get(8..)?))
}

/// The boxes laid end to end in `data`: (type, payload).
fn boxes(data: &[u8]) -> impl Iterator<Item = ([u8; 4], &[u8])> {
    let mut pos = 0usize;
    std::iter::from_fn(move || {
        let header = data.get(pos..pos + 8)?;
        let size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
        let kind = [header[4], header[5], header[6], header[7]];
        if size < 8 {
            return None;
        }
        let payload = data.get(pos + 8..pos + size)?;
        pos += size;
        Some((kind, payload))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An `ilst` item holding one `data` atom.
    fn item(kind: &[u8; 4], type_code: u32, value: &[u8]) -> Vec<u8> {
        let data_len = 16 + value.len();
        let mut out = ((8 + data_len) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(&(data_len as u32).to_be_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&type_code.to_be_bytes());
        out.extend_from_slice(&[0, 0, 0, 0]);
        out.extend_from_slice(value);
        out
    }

    #[test]
    fn reads_copyright_sign_items_and_binary_numbers() {
        let mut ilst = Vec::new();
        ilst.extend(item(b"\xa9nam", 1, b"Big Dawgs"));
        ilst.extend(item(b"aART", 1, b"ASAP Rocky"));
        ilst.extend(item(b"trkn", 0, &[0, 0, 0, 3, 0, 12, 0, 0]));
        ilst.extend(item(b"tmpo", 21, &[0, 120]));
        ilst.extend(item(b"gnre", 0, &[0, 18]));

        let mut set = TagSet::default();
        read(&ilst, &mut set);
        let get = |k: &str| set.0.get(k).map(String::as_str);
        assert_eq!(get("Title"), Some("Big Dawgs"));
        assert_eq!(get("Album_Performer"), Some("ASAP Rocky"));
        assert_eq!(get("Track_Position"), Some("3"));
        assert_eq!(get("Track_Position_Total"), Some("12"));
        assert_eq!(get("BPM"), Some("120"));
        assert_eq!(get("Genre"), Some("Rock"));
    }
}
