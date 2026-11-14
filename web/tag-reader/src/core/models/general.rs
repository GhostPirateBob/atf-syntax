use crate::core::types::{BitrateMode, ContainerFormat};
use std::collections::BTreeMap;

/// The file as a whole: its container and its metadata tags.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GeneralTrack {
    /// The path as given (MediaInfo's `CompleteName`), when inspected from a path.
    pub file_name: Option<String>,
    pub file_size: u64,
    pub format: ContainerFormat,
    pub format_profile: Option<String>,
    pub format_version: Option<String>,
    pub codec_id: Option<String>,
    pub duration_ms: Option<f64>,
    pub overall_bitrate: Option<u64>,
    pub overall_bitrate_mode: Option<BitrateMode>,
    /// Metadata tags under MediaInfo's field names (`Title`, `Performer`, `Track_Position`, ...),
    /// so the JSON reads like `mediainfo --Output=JSON`.
    pub tags: BTreeMap<String, String>,
}

impl GeneralTrack {
    /// A tag's value, by its MediaInfo field name.
    pub fn tag(&self, field: &str) -> Option<&str> {
        self.tags.get(field).map(String::as_str)
    }

    /// Takes the tags read from one source. A field already filled by an earlier source keeps
    /// its value, so a file's tag formats are merged in order of preference (ID3v2, then APE,
    /// then ID3v1, as MediaInfo prefers them).
    pub fn merge_tags(&mut self, set: TagSet) {
        for (field, value) in set.0 {
            self.tags.entry(field).or_insert(value);
        }
    }
}

/// The tags read from one tag block, under MediaInfo's field names. A field given more than once
/// (two ARTIST comments, an ID3v2.4 multi-value frame) is joined with ` / `, as MediaInfo shows it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TagSet(pub BTreeMap<String, String>);

impl TagSet {
    pub fn push(&mut self, field: &str, value: &str) {
        let value = value.trim_matches(|c: char| c == '\0' || c.is_whitespace());
        if value.is_empty() {
            return;
        }
        self.0
            .entry(field.to_string())
            .and_modify(|v| {
                if v != value {
                    v.push_str(" / ");
                    v.push_str(value);
                }
            })
            .or_insert_with(|| value.to_string());
    }

    /// Sets a field outright, replacing any value from the same tag block.
    pub fn set(&mut self, field: &str, value: &str) {
        let value = value.trim();
        if !value.is_empty() {
            self.0.insert(field.to_string(), value.to_string());
        }
    }

    pub fn contains(&self, field: &str) -> bool {
        self.0.contains_key(field)
    }
}
