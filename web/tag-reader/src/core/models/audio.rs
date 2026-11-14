use crate::core::types::*;

/// An audio stream.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AudioTrack {
    pub stream_id: u32,
    pub format: AudioCodec,
    pub format_info: Option<String>,
    pub format_profile: Option<String>,
    pub codec_id: Option<String>,
    pub duration_ms: Option<f64>,
    pub bit_rate: Option<u64>,
    pub bit_rate_mode: Option<BitrateMode>,
    /// 0 when the container doesn't say.
    pub channels: u32,
    pub channel_layout: Option<AudioChannelLayout>,
    /// Hz; 0 when the container doesn't say.
    pub sampling_rate: u32,
    pub frame_count: Option<u64>,
    pub bit_depth: Option<u8>,
    pub compression_mode: Option<String>, // Lossy, Lossless
    pub stream_size: Option<u64>,
    /// The encoder library, e.g. a Vorbis comment block's vendor string or MP3's LAME tag.
    pub encoded_library: Option<String>,
    pub title: Option<String>,
    pub language: Option<String>,
    pub default: Option<bool>,
    pub forced: Option<bool>,
}
