use crate::core::types::*;

/// A video stream.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct VideoTrack {
    pub stream_id: u32,
    pub format: VideoCodec,
    pub format_info: Option<String>,
    pub format_profile: Option<String>,
    pub format_version: Option<String>,
    pub format_level: Option<String>,
    pub format_tier: Option<String>,
    pub codec_id: Option<String>,
    pub codec_id_info: Option<String>,
    pub duration_ms: Option<f64>,
    pub bit_rate: Option<u64>,
    pub width: u32,
    pub height: u32,
    pub stored_width: Option<u32>,
    pub stored_height: Option<u32>,
    pub sample_aspect_ratio: Option<f64>,
    pub display_aspect_ratio: Option<f64>,
    pub frame_rate_mode: Option<FrameRateMode>,
    pub frame_rate: Option<f64>,
    pub frame_count: Option<u64>,
    pub color_space: Option<String>, // YUV, RGB
    pub chroma_subsampling: Option<ChromaSubsampling>,
    /// 0 when unknown.
    pub bit_depth: u8,
    pub scan_type: Option<String>,        // Progressive, Interlaced
    pub scan_order: Option<String>,       // TFF, BFF
    pub compression_mode: Option<String>, // Lossy, Lossless
    pub stream_size: Option<u64>,
    pub encoded_library: Option<String>,
    pub color_range: Option<ColorRange>,
    pub color_primaries: Option<ColorPrimaries>,
    pub transfer_characteristics: Option<TransferCharacteristics>,
    pub matrix_coefficients: Option<MatrixCoefficients>,
    pub hdr_format: Option<String>, // HDR10, HLG
    pub title: Option<String>,
    pub language: Option<String>,
    pub default: Option<bool>,
    pub forced: Option<bool>,
}
