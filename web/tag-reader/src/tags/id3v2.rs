//! ID3v2.2 / 2.3 / 2.4 tags, as found at the start of MP3s (and in AIFF, WAV and DSF chunks).

use super::{genre_name, latin1, push_named, push_position};
use crate::core::models::TagSet;

/// The length of the ID3v2 tag at the start of `head` (header, frames and any footer), if
/// `head` starts with one. Only the first 10 bytes are needed.
pub fn tag_len(head: &[u8]) -> Option<u64> {
    if head.len() < 10 || &head[..3] != b"ID3" || !(2..=4).contains(&head[3]) {
        return None;
    }
    let size = synchsafe(&head[6..10])?;
    let footer = if head[3] == 4 && head[5] & 0x10 != 0 {
        10
    } else {
        0
    };
    Some(10 + size as u64 + footer)
}

fn synchsafe(b: &[u8]) -> Option<u32> {
    b.iter()
        .try_fold(0u32, |acc, &x| (x < 0x80).then_some((acc << 7) | x as u32))
}

/// Removes unsynchronisation: every `FF 00` pair is stored for a literal `FF`.
fn resync(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        out.push(data[i]);
        if data[i] == 0xFF && data.get(i + 1) == Some(&0) {
            i += 1;
        }
        i += 1;
    }
    out
}

/// Reads an ID3v2 tag (the whole thing, from `ID3`) into MediaInfo fields.
pub fn read(tag: &[u8], set: &mut TagSet) {
    let Some(len) = tag_len(tag) else { return };
    let major = tag[3];
    let flags = tag[5];
    let end = (len as usize).min(tag.len());
    let footer = if major == 4 && flags & 0x10 != 0 {
        10
    } else {
        0
    };
    let raw = &tag[10..end.saturating_sub(footer).max(10)];

    // ID3v2.2 used this bit for a compression scheme that was never defined.
    if major == 2 && flags & 0x40 != 0 {
        return;
    }
    // v2.2 / v2.3 unsynchronise the whole tag; v2.4 marks it per frame instead.
    let resynced;
    let mut body = if flags & 0x80 != 0 && major < 4 {
        resynced = resync(raw);
        &resynced[..]
    } else {
        raw
    };
    if major >= 3 && flags & 0x40 != 0 && body.len() >= 4 {
        // Extended header: v2.3's size leaves out its own 4 bytes, v2.4's (synchsafe) counts them.
        let skip = if major == 3 {
            4 + u32::from_be_bytes([body[0], body[1], body[2], body[3]]) as usize
        } else {
            synchsafe(&body[..4]).unwrap_or(0) as usize
        };
        body = body.get(skip..).unwrap_or(&[]);
    }

    let mut frames = Frames::default();
    let (id_len, header_len) = if major == 2 { (3, 6) } else { (4, 10) };
    let mut pos = 0;
    while pos + header_len <= body.len() {
        let id = &body[pos..pos + id_len];
        if !id
            .iter()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        {
            break; // padding, or the end of the frames
        }
        let size = match major {
            2 => u32::from_be_bytes([0, body[pos + 3], body[pos + 4], body[pos + 5]]),
            3 => u32::from_be_bytes([body[pos + 4], body[pos + 5], body[pos + 6], body[pos + 7]]),
            // v2.4 sizes are synchsafe, but some writers (old iTunes) stored plain integers.
            _ => synchsafe(&body[pos + 4..pos + 8]).unwrap_or_else(|| {
                u32::from_be_bytes([body[pos + 4], body[pos + 5], body[pos + 6], body[pos + 7]])
            }),
        } as usize;
        let start = pos + header_len;
        let Some(stop) = start.checked_add(size).filter(|&s| s <= body.len()) else {
            break;
        };
        let format_flags = if major >= 3 { body[pos + 9] } else { 0 };
        let mut data = &body[start..stop];
        pos = stop;

        let owned;
        if major == 3 {
            if format_flags & 0xC0 != 0 {
                continue; // compressed or encrypted
            }
            if format_flags & 0x20 != 0 {
                data = data.get(1..).unwrap_or(&[]); // group id
            }
        } else if major == 4 {
            if format_flags & 0x0C != 0 {
                continue; // compressed or encrypted
            }
            if format_flags & 0x40 != 0 {
                data = data.get(1..).unwrap_or(&[]); // group id
            }
            if format_flags & 0x01 != 0 {
                data = data.get(4..).unwrap_or(&[]); // data length indicator
            }
            if format_flags & 0x02 != 0 || flags & 0x80 != 0 {
                owned = resync(data);
                data = &owned;
            }
        }
        frames.frame(id, data, set);
    }
    frames.finish(set);
}

/// Frames that combine with others (v2.3's year, date and original year).
#[derive(Default)]
struct Frames {
    year: Option<String>,
    date: Option<String>,
}

impl Frames {
    fn frame(&mut self, id: &[u8], data: &[u8], set: &mut TagSet) {
        let text = || text_values(data);
        let each = |set: &mut TagSet, field: &str| {
            for v in text_values(data) {
                set.push(field, &v);
            }
        };
        match id {
            b"TIT2" | b"TT2" => each(set, "Title"),
            b"TPE1" | b"TP1" => each(set, "Performer"),
            b"TPE2" | b"TP2" => each(set, "Album_Performer"),
            b"TPE3" | b"TP3" => each(set, "Conductor"),
            b"TPE4" | b"TP4" => each(set, "RemixedBy"),
            b"TALB" | b"TAL" => each(set, "Album"),
            b"TCOM" | b"TCM" => each(set, "Composer"),
            b"TEXT" | b"TXT" => each(set, "Lyricist"),
            b"TPUB" | b"TPB" => each(set, "Publisher"),
            b"TSRC" | b"TRC" => each(set, "ISRC"),
            b"TBPM" | b"TBP" => each(set, "BPM"),
            b"TCOP" | b"TCR" => each(set, "Copyright"),
            b"TENC" | b"TEN" => each(set, "EncodedBy"),
            b"TSSE" | b"TSS" => each(set, "Encoded_Library"),
            b"TLAN" | b"TLA" => each(set, "Language"),
            b"TIT1" | b"TT1" => each(set, "Grouping"),
            b"TIT3" | b"TT3" => each(set, "Track_More"),
            b"TMOO" => each(set, "Mood"),
            b"TCMP" | b"TCP" => each(set, "Compilation"),
            b"TCON" | b"TCO" => {
                for v in text() {
                    set.push("Genre", &genre_name(&v));
                }
            }
            b"TRCK" | b"TRK" => {
                if let Some(v) = text().into_iter().next() {
                    push_position(set, "Track_Position", "Track_Position_Total", &v);
                }
            }
            b"TPOS" | b"TPA" => {
                if let Some(v) = text().into_iter().next() {
                    push_position(set, "Part_Position", "Part_Position_Total", &v);
                }
            }
            b"TDRC" => each(set, "Recorded_Date"),
            b"TDRL" => each(set, "Released_Date"),
            b"TDOR" | b"TORY" | b"TOR" => each(set, "Original_Released_Date"),
            b"TYER" | b"TYE" => self.year = text().into_iter().next(),
            b"TDAT" | b"TDA" => self.date = text().into_iter().next(),
            b"COMM" | b"COM" => {
                // encoding, language[3], short description, text: only the plain comment (no
                // description) is the one players show; iTunNORM and friends carry data.
                if data.len() > 4 {
                    let parts = split_strings(data[0], &data[4..]);
                    if let [desc, value, ..] = parts.as_slice()
                        && desc.is_empty()
                    {
                        set.push("Comment", value);
                    }
                }
            }
            b"TXXX" | b"TXX" => {
                if let Some((&enc, rest)) = data.split_first() {
                    let parts = split_strings(enc, rest);
                    if let [desc, values @ ..] = parts.as_slice() {
                        for v in values {
                            push_named(set, desc, v);
                        }
                    }
                }
            }
            b"APIC" | b"PIC" => set.set("Cover", "Yes"),
            _ => {}
        }
    }

    fn finish(self, set: &mut TagSet) {
        // v2.3 keeps the year (TYER) and day-month (TDAT, DDMM) apart.
        if let Some(year) = self.year {
            let date = match self.date.as_deref() {
                Some(d) if d.len() == 4 && d.bytes().all(|b| b.is_ascii_digit()) => {
                    format!("{year}-{}-{}", &d[2..4], &d[0..2])
                }
                _ => year,
            };
            set.push("Recorded_Date", &date);
        }
    }
}

/// A text frame's values: its encoding byte, then one or more strings (ID3v2.4 separates
/// multiple values with a terminator).
fn text_values(data: &[u8]) -> Vec<String> {
    match data.split_first() {
        Some((&enc, rest)) => split_strings(enc, rest)
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect(),
        None => Vec::new(),
    }
}

/// Splits terminated strings in one of ID3v2's four encodings.
fn split_strings(encoding: u8, data: &[u8]) -> Vec<String> {
    match encoding {
        1 | 2 => {
            let mut out = Vec::new();
            let mut start = 0;
            let mut i = 0;
            while i + 1 < data.len() {
                if data[i] == 0 && data[i + 1] == 0 {
                    out.push(utf16(encoding, &data[start..i]));
                    start = i + 2;
                }
                i += 2;
            }
            if start < data.len() {
                out.push(utf16(encoding, &data[start..]));
            }
            out
        }
        _ => data
            .split(|&b| b == 0)
            .map(|part| {
                if encoding == 3 {
                    String::from_utf8_lossy(part).into_owned()
                } else {
                    latin1(part)
                }
            })
            .collect(),
    }
    .into_iter()
    .map(|s| s.trim().to_string())
    .collect()
}

/// UTF-16 with a byte order mark (encoding 1, little-endian when it has none) or big-endian
/// without one (encoding 2).
fn utf16(encoding: u8, bytes: &[u8]) -> String {
    let (mut be, mut body) = (encoding == 2, bytes);
    if bytes.len() >= 2 {
        match (bytes[0], bytes[1]) {
            (0xFF, 0xFE) => (be, body) = (false, &bytes[2..]),
            (0xFE, 0xFF) => (be, body) = (true, &bytes[2..]),
            _ => {}
        }
    }
    let units: Vec<u16> = body
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| {
            if be {
                u16::from_be_bytes([c[0], c[1]])
            } else {
                u16::from_le_bytes([c[0], c[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(major: u8, frames: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let mut body = Vec::new();
        for (id, data) in frames {
            body.extend_from_slice(*id);
            let len = data.len() as u32;
            if major == 4 {
                body.extend_from_slice(&[
                    (len >> 21) as u8 & 0x7F,
                    (len >> 14) as u8 & 0x7F,
                    (len >> 7) as u8 & 0x7F,
                    len as u8 & 0x7F,
                ]);
            } else {
                body.extend_from_slice(&len.to_be_bytes());
            }
            body.extend_from_slice(&[0, 0]);
            body.extend_from_slice(data);
        }
        let n = body.len() as u32;
        let mut out = b"ID3".to_vec();
        out.extend_from_slice(&[major, 0, 0]);
        out.extend_from_slice(&[
            (n >> 21) as u8 & 0x7F,
            (n >> 14) as u8 & 0x7F,
            (n >> 7) as u8 & 0x7F,
            n as u8 & 0x7F,
        ]);
        out.extend_from_slice(&body);
        out
    }

    fn latin(s: &str) -> Vec<u8> {
        let mut v = vec![0u8];
        v.extend_from_slice(s.as_bytes());
        v
    }

    #[test]
    fn reads_common_v2_3_frames() {
        let mut comm = vec![0u8];
        comm.extend_from_slice(b"eng\0Nice one");
        let mut txxx = vec![0u8];
        txxx.extend_from_slice(b"REPLAYGAIN_TRACK_GAIN\0-6.54 dB");
        let t = tag(
            3,
            &[
                (b"TIT2", latin("Big Dawgs")),
                (b"TPE2", latin("Hanumankind")),
                (b"TRCK", latin("3/12")),
                (b"TPOS", latin("1/2")),
                (b"TCON", latin("(17)")),
                (b"TYER", latin("2024")),
                (b"TDAT", latin("0105")),
                (b"COMM", comm),
                (b"TXXX", txxx),
            ],
        );
        assert_eq!(tag_len(&t), Some(t.len() as u64));
        let mut set = TagSet::default();
        read(&t, &mut set);
        let get = |k: &str| set.0.get(k).map(String::as_str);
        assert_eq!(get("Title"), Some("Big Dawgs"));
        assert_eq!(get("Album_Performer"), Some("Hanumankind"));
        assert_eq!(get("Track_Position"), Some("3"));
        assert_eq!(get("Track_Position_Total"), Some("12"));
        assert_eq!(get("Part_Position"), Some("1"));
        assert_eq!(get("Part_Position_Total"), Some("2"));
        assert_eq!(get("Genre"), Some("Rock"));
        assert_eq!(get("Recorded_Date"), Some("2024-05-01"));
        assert_eq!(get("Comment"), Some("Nice one"));
        assert_eq!(get("ReplayGain_Gain"), Some("-6.54"));
    }

    #[test]
    fn reads_v2_4_utf16_multi_values() {
        // UTF-16 with BOM, two values separated by a double NUL.
        let mut data = vec![1u8];
        for s in ["A", "B"] {
            data.extend_from_slice(&[0xFF, 0xFE]);
            for u in s.encode_utf16() {
                data.extend_from_slice(&u.to_le_bytes());
            }
            data.extend_from_slice(&[0, 0]);
        }
        let t = tag(4, &[(b"TPE1", data)]);
        let mut set = TagSet::default();
        read(&t, &mut set);
        assert_eq!(set.0.get("Performer").map(String::as_str), Some("A / B"));
    }
}
