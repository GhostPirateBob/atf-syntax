//! Metadata tag formats, read into MediaInfo's field names (`Title`, `Performer`,
//! `Track_Position`, ...) through a [`TagSet`].

pub mod ape;
pub mod id3v1;
pub mod id3v2;
pub mod itunes;
pub mod vorbis;

use crate::core::models::TagSet;

/// MediaInfo's field for a free-form tag name: a Vorbis comment, an APE item, a Matroska
/// SimpleTag, an ID3v2 `TXXX` description or an MP4 `----` atom name. Case, spaces, `_` and `-`
/// don't matter (`ALBUMARTIST`, `Album Artist`, `ALBUM_ARTIST`).
pub fn named_field(name: &str) -> Option<&'static str> {
    let key: String = name
        .chars()
        .filter(|c| !matches!(c, ' ' | '_' | '-'))
        .map(|c| c.to_ascii_uppercase())
        .collect();
    Some(match key.as_str() {
        "TITLE" => "Title",
        "ARTIST" => "Performer",
        "ALBUM" => "Album",
        "ALBUMARTIST" => "Album_Performer",
        "GENRE" => "Genre",
        "COMPOSER" => "Composer",
        "COMMENT" | "COMMENTS" => "Comment",
        "DESCRIPTION" => "Description",
        "DATE" | "YEAR" | "DATERECORDED" => "Recorded_Date",
        "DATERELEASED" | "RELEASEDATE" => "Released_Date",
        "ORIGINALDATE" | "ORIGINALYEAR" | "ORIGINALRELEASEDATE" => "Original_Released_Date",
        "TRACKNUMBER" | "TRACK" | "PARTNUMBER" => "Track_Position",
        "TRACKTOTAL" | "TOTALTRACKS" | "TOTALPARTS" => "Track_Position_Total",
        "DISCNUMBER" | "DISC" => "Part_Position",
        "DISCTOTAL" | "TOTALDISCS" => "Part_Position_Total",
        "ISRC" => "ISRC",
        "BPM" => "BPM",
        "CONDUCTOR" => "Conductor",
        "LYRICIST" => "Lyricist",
        "PRODUCER" => "Producer",
        "DIRECTOR" => "Director",
        "PUBLISHER" => "Publisher",
        "LABEL" => "Label",
        "COPYRIGHT" => "Copyright",
        "ENCODER" => "Encoded_Application",
        "ENCODEDBY" => "EncodedBy",
        "LANGUAGE" => "Language",
        "LYRICS" | "UNSYNCEDLYRICS" => "Lyrics",
        "GROUPING" => "Grouping",
        "MOOD" => "Mood",
        "COMPILATION" => "Compilation",
        "REMIXER" | "MIXARTIST" => "RemixedBy",
        "REPLAYGAINTRACKGAIN" => "ReplayGain_Gain",
        "REPLAYGAINTRACKPEAK" => "ReplayGain_Peak",
        "REPLAYGAINALBUMGAIN" => "Album_ReplayGain_Gain",
        "REPLAYGAINALBUMPEAK" => "Album_ReplayGain_Peak",
        _ => return None,
    })
}

/// Adds a free-form tag under its MediaInfo field; names MediaInfo has no field for are dropped.
pub fn push_named(set: &mut TagSet, name: &str, value: &str) {
    if let Some(field) = named_field(name) {
        let value = if field.contains("ReplayGain") {
            replaygain(value)
        } else {
            value
        };
        set.push(field, value);
    }
}

/// ReplayGain as MediaInfo shows it: the number alone (`-6.54 dB` reads `-6.54`).
fn replaygain(value: &str) -> &str {
    let v = value.trim();
    v.strip_suffix("dB")
        .or_else(|| v.strip_suffix("DB"))
        .map(str::trim_end)
        .unwrap_or(v)
}

/// Splits a `3/12`-style position into its two MediaInfo fields.
pub fn push_position(set: &mut TagSet, position_field: &str, total_field: &str, value: &str) {
    match value.split_once('/') {
        Some((pos, total)) => {
            set.push(position_field, pos);
            set.push(total_field, total);
        }
        None => set.push(position_field, value),
    }
}

/// A genre written as an ID3v1 genre number, `17` or `(17)`, as its name; anything else as is.
/// `(17)Rock`-style refinements keep the text.
pub fn genre_name(value: &str) -> String {
    let v = value.trim();
    if let Ok(n) = v.parse::<usize>() {
        return GENRES
            .get(n)
            .map_or_else(|| v.to_string(), |g| g.to_string());
    }
    if let Some(rest) = v.strip_prefix('(')
        && let Some((inner, after)) = rest.split_once(')')
    {
        if !after.trim().is_empty() {
            return after.trim().to_string();
        }
        return match inner {
            "RX" => "Remix".to_string(),
            "CR" => "Cover".to_string(),
            _ => inner
                .parse::<usize>()
                .ok()
                .and_then(|n| GENRES.get(n))
                .map_or_else(|| v.to_string(), |g| g.to_string()),
        };
    }
    v.to_string()
}

/// ID3v1 genres 0-191 (80 onwards are Winamp's extensions).
pub const GENRES: [&str; 192] = [
    "Blues",
    "Classic Rock",
    "Country",
    "Dance",
    "Disco",
    "Funk",
    "Grunge",
    "Hip-Hop",
    "Jazz",
    "Metal",
    "New Age",
    "Oldies",
    "Other",
    "Pop",
    "R&B",
    "Rap",
    "Reggae",
    "Rock",
    "Techno",
    "Industrial",
    "Alternative",
    "Ska",
    "Death Metal",
    "Pranks",
    "Soundtrack",
    "Euro-Techno",
    "Ambient",
    "Trip-Hop",
    "Vocal",
    "Jazz+Funk",
    "Fusion",
    "Trance",
    "Classical",
    "Instrumental",
    "Acid",
    "House",
    "Game",
    "Sound Clip",
    "Gospel",
    "Noise",
    "Alt. Rock",
    "Bass",
    "Soul",
    "Punk",
    "Space",
    "Meditative",
    "Instrumental Pop",
    "Instrumental Rock",
    "Ethnic",
    "Gothic",
    "Darkwave",
    "Techno-Industrial",
    "Electronic",
    "Pop-Folk",
    "Eurodance",
    "Dream",
    "Southern Rock",
    "Comedy",
    "Cult",
    "Gangsta Rap",
    "Top 40",
    "Christian Rap",
    "Pop/Funk",
    "Jungle",
    "Native American",
    "Cabaret",
    "New Wave",
    "Psychedelic",
    "Rave",
    "Showtunes",
    "Trailer",
    "Lo-Fi",
    "Tribal",
    "Acid Punk",
    "Acid Jazz",
    "Polka",
    "Retro",
    "Musical",
    "Rock & Roll",
    "Hard Rock",
    "Folk",
    "Folk-Rock",
    "National Folk",
    "Swing",
    "Fast-Fusion",
    "Bebop",
    "Latin",
    "Revival",
    "Celtic",
    "Bluegrass",
    "Avantgarde",
    "Gothic Rock",
    "Progressive Rock",
    "Psychedelic Rock",
    "Symphonic Rock",
    "Slow Rock",
    "Big Band",
    "Chorus",
    "Easy Listening",
    "Acoustic",
    "Humour",
    "Speech",
    "Chanson",
    "Opera",
    "Chamber Music",
    "Sonata",
    "Symphony",
    "Booty Bass",
    "Primus",
    "Porn Groove",
    "Satire",
    "Slow Jam",
    "Club",
    "Tango",
    "Samba",
    "Folklore",
    "Ballad",
    "Power Ballad",
    "Rhythmic Soul",
    "Freestyle",
    "Duet",
    "Punk Rock",
    "Drum Solo",
    "A Cappella",
    "Euro-House",
    "Dance Hall",
    "Goa",
    "Drum & Bass",
    "Club-House",
    "Hardcore",
    "Terror",
    "Indie",
    "BritPop",
    "Afro-Punk",
    "Polsk Punk",
    "Beat",
    "Christian Gangsta Rap",
    "Heavy Metal",
    "Black Metal",
    "Crossover",
    "Contemporary Christian",
    "Christian Rock",
    "Merengue",
    "Salsa",
    "Thrash Metal",
    "Anime",
    "JPop",
    "Synthpop",
    "Abstract",
    "Art Rock",
    "Baroque",
    "Bhangra",
    "Big Beat",
    "Breakbeat",
    "Chillout",
    "Downtempo",
    "Dub",
    "EBM",
    "Eclectic",
    "Electro",
    "Electroclash",
    "Emo",
    "Experimental",
    "Garage",
    "Global",
    "IDM",
    "Illbient",
    "Industro-Goth",
    "Jam Band",
    "Krautrock",
    "Leftfield",
    "Lounge",
    "Math Rock",
    "New Romantic",
    "Nu-Breakz",
    "Post-Punk",
    "Post-Rock",
    "Psytrance",
    "Shoegaze",
    "Space Rock",
    "Trop Rock",
    "World Music",
    "Neoclassical",
    "Audiobook",
    "Audio Theatre",
    "Neue Deutsche Welle",
    "Podcast",
    "Indie Rock",
    "G-Funk",
    "Dubstep",
    "Garage Rock",
    "Psybient",
];

/// ISO-8859-1 bytes as text (every byte is the code point of the same number).
pub fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_form_names_map_to_mediainfo_fields() {
        assert_eq!(named_field("Album Artist"), Some("Album_Performer"));
        assert_eq!(named_field("ALBUM_ARTIST"), Some("Album_Performer"));
        assert_eq!(
            named_field("replaygain_track_gain"),
            Some("ReplayGain_Gain")
        );
        assert_eq!(named_field("unheard-of"), None);
    }

    #[test]
    fn id3_genre_numbers_become_names() {
        assert_eq!(genre_name("17"), "Rock");
        assert_eq!(genre_name("(17)"), "Rock");
        assert_eq!(genre_name("(17)Indie Rock"), "Indie Rock");
        assert_eq!(genre_name("(RX)"), "Remix");
        assert_eq!(genre_name("Shoegaze"), "Shoegaze");
        assert_eq!(genre_name("255"), "255");
    }

    #[test]
    fn replaygain_drops_the_unit() {
        let mut set = TagSet::default();
        push_named(&mut set, "REPLAYGAIN_TRACK_GAIN", "-6.54 dB");
        assert_eq!(
            set.0.get("ReplayGain_Gain").map(String::as_str),
            Some("-6.54")
        );
    }
}
