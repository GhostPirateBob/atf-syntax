use super::{audio::AudioTrack, general::GeneralTrack, text::TextTrack, video::VideoTrack};

/// Everything read from one file.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MediaReport {
    pub general: GeneralTrack,
    pub videos: Vec<VideoTrack>,
    pub audios: Vec<AudioTrack>,
    pub texts: Vec<TextTrack>,
}

impl MediaReport {
    pub fn new() -> Self {
        Self::default()
    }

    /// The report in MediaInfo's JSON schema (`{"media": {"track": [...]}}`), as
    /// `mediainfo --Output=JSON` writes it.
    pub fn to_json(&self) -> crate::core::error::Result<String> {
        Ok(serde_json::to_string_pretty(&crate::json::to_value(self))?)
    }
}
