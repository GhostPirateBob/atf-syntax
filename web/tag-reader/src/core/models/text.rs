use crate::core::types::SubtitleCodec;

/// A subtitle / text stream.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TextTrack {
    pub stream_id: u32,
    pub format: SubtitleCodec,
    pub format_info: Option<String>,
    pub codec_id: Option<String>,
    pub duration_ms: Option<f64>,
    pub title: Option<String>,
    pub language: Option<String>,
    pub default: Option<bool>,
    pub forced: Option<bool>,
}
