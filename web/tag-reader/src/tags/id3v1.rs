use super::{GENRES, latin1};
use crate::core::models::TagSet;

/// Reads a 128-byte ID3v1 / v1.1 tag (`TAG` + fixed fields, ISO-8859-1). Returns whether `tag`
/// is one.
pub fn read(tag: &[u8], set: &mut TagSet) -> bool {
    if tag.len() != 128 || &tag[..3] != b"TAG" {
        return false;
    }
    let field = |bytes: &[u8]| {
        latin1(bytes.split(|&b| b == 0).next().unwrap_or(bytes))
            .trim()
            .to_string()
    };

    set.push("Title", &field(&tag[3..33]));
    set.push("Performer", &field(&tag[33..63]));
    set.push("Album", &field(&tag[63..93]));
    set.push("Recorded_Date", &field(&tag[93..97]));
    // ID3v1.1 steals the comment's last two bytes for a zero and the track number.
    if tag[125] == 0 && tag[126] != 0 {
        set.push("Comment", &field(&tag[97..125]));
        set.push("Track_Position", &tag[126].to_string());
    } else {
        set.push("Comment", &field(&tag[97..127]));
    }
    if let Some(genre) = GENRES.get(tag[127] as usize) {
        set.push("Genre", genre);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_v1_1_with_track_number() {
        let mut data = vec![0u8; 128];
        data[0..3].copy_from_slice(b"TAG");
        data[3..13].copy_from_slice(b"Test Song\0");
        data[33..45].copy_from_slice(b"Test Artist\0");
        data[63..74].copy_from_slice(b"Test Album\0");
        data[93..97].copy_from_slice(b"2026");
        data[126] = 5;
        data[127] = 17;
        data[97] = 0xE9; // é in ISO-8859-1

        let mut set = TagSet::default();
        assert!(read(&data, &mut set));
        let get = |k: &str| set.0.get(k).cloned();
        assert_eq!(get("Title").as_deref(), Some("Test Song"));
        assert_eq!(get("Performer").as_deref(), Some("Test Artist"));
        assert_eq!(get("Recorded_Date").as_deref(), Some("2026"));
        assert_eq!(get("Track_Position").as_deref(), Some("5"));
        assert_eq!(get("Genre").as_deref(), Some("Rock"));
        assert_eq!(get("Comment").as_deref(), Some("é"));
    }
}
