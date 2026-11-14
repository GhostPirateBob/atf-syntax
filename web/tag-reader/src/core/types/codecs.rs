/// Known container and multiplexed stream formats.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ContainerFormat {
    MPEG4,
    Matroska,
    WebM,
    QuickTime,
    AVI,
    WAV,
    MPEGTS,
    BDAV,
    MPEGPS,
    Ogg,
    ASF,
    FLAC,
    MP3,
    AAC,
    MPC,
    DSF,
    DSDIFF,
    APE,
    WavPack,
    AIFF,
    #[default]
    Unknown,
}

impl ContainerFormat {
    /// MediaInfo's `Format` name.
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::MPEG4 => "MPEG-4",
            Self::Matroska => "Matroska",
            Self::WebM => "WebM",
            Self::QuickTime => "QuickTime",
            Self::AVI => "AVI",
            Self::WAV => "Wave",
            Self::MPEGTS => "MPEG-TS",
            Self::BDAV => "BDAV",
            Self::MPEGPS => "MPEG-PS",
            Self::Ogg => "Ogg",
            Self::ASF => "Windows Media",
            Self::FLAC => "FLAC",
            Self::MP3 => "MPEG Audio",
            Self::AAC => "ADTS",
            Self::MPC => "Musepack",
            Self::DSF => "DSF",
            Self::DSDIFF => "DSDIFF",
            Self::APE => "Monkey's Audio",
            Self::WavPack => "WavPack",
            Self::AIFF => "AIFF",
            Self::Unknown => "Unknown",
        }
    }
}

/// Video elementary stream codecs.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum VideoCodec {
    AVC,
    HEVC,
    AV1,
    VP9,
    VP8,
    ProRes,
    MPEG1Video,
    MPEG2Video,
    MPEG4Visual,
    VC1,
    VVC,
    CineForm,
    Theora,
    DV,
    DNxHD,
    FFV1,
    Raw,
    Other(String),
}

impl Default for VideoCodec {
    fn default() -> Self {
        Self::Other("Unknown".to_string())
    }
}

impl VideoCodec {
    /// MediaInfo's `Format` name.
    pub fn display_name(&self) -> &str {
        match self {
            Self::AVC => "AVC",
            Self::HEVC => "HEVC",
            Self::AV1 => "AV1",
            Self::VP9 => "VP9",
            Self::VP8 => "VP8",
            Self::ProRes => "ProRes",
            Self::MPEG1Video | Self::MPEG2Video => "MPEG Video",
            Self::MPEG4Visual => "MPEG-4 Visual",
            Self::VC1 => "VC-1",
            Self::VVC => "VVC",
            Self::CineForm => "CineForm",
            Self::Theora => "Theora",
            Self::DV => "DV",
            Self::DNxHD => "VC-3",
            Self::FFV1 => "FFV1",
            Self::Raw => "Raw Video",
            Self::Other(name) => name.as_str(),
        }
    }
}

/// Audio elementary stream codecs.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[allow(non_camel_case_types)]
pub enum AudioCodec {
    AAC,
    AC3,
    EAC3,
    TrueHD,
    DTS,
    DTSHD,
    FLAC,
    MPEGAudioLayer3,
    MPEGAudioLayer2,
    MPEGAudioLayer1,
    Opus,
    Vorbis,
    PCM,
    ALAC,
    WMA,
    MonkeyAudio,
    WavPack,
    MPC,
    DSD,
    AC4,
    MPEGH,
    AMR_NB,
    AMR_WB,
    TTA,
    Other(String),
}

impl Default for AudioCodec {
    fn default() -> Self {
        Self::Other("Unknown".to_string())
    }
}

impl AudioCodec {
    /// MediaInfo's `Format` name.
    pub fn display_name(&self) -> &str {
        match self {
            Self::AAC => "AAC",
            Self::AC3 => "AC-3",
            Self::EAC3 => "E-AC-3",
            Self::TrueHD => "MLP FBA",
            Self::DTS => "DTS",
            Self::DTSHD => "DTS-HD",
            Self::FLAC => "FLAC",
            Self::MPEGAudioLayer3 | Self::MPEGAudioLayer2 | Self::MPEGAudioLayer1 => "MPEG Audio",
            Self::Opus => "Opus",
            Self::Vorbis => "Vorbis",
            Self::PCM => "PCM",
            Self::ALAC => "ALAC",
            Self::WMA => "WMA",
            Self::MonkeyAudio => "Monkey's Audio",
            Self::WavPack => "WavPack",
            Self::MPC => "Musepack",
            Self::DSD => "DSD",
            Self::AC4 => "AC-4",
            Self::MPEGH => "MPEG-H 3D Audio",
            Self::AMR_NB => "AMR",
            Self::AMR_WB => "AMR",
            Self::TTA => "TTA",
            Self::Other(name) => name.as_str(),
        }
    }

    /// The `Format_Profile` MediaInfo gives when the stream itself says nothing more specific.
    pub fn format_profile(&self) -> Option<&'static str> {
        match self {
            Self::MPEGAudioLayer3 => Some("Layer 3"),
            Self::MPEGAudioLayer2 => Some("Layer 2"),
            Self::MPEGAudioLayer1 => Some("Layer 1"),
            _ => None,
        }
    }
}

/// Subtitle / text codecs.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum SubtitleCodec {
    SubRip,
    ASS,
    SSA,
    PGS,
    VobSub,
    WebVTT,
    TTML,
    EIA608,
    EIA708,
    DVBSubtitle,
    Teletext,
    Other(String),
}

impl Default for SubtitleCodec {
    fn default() -> Self {
        Self::Other("Unknown".to_string())
    }
}

impl SubtitleCodec {
    pub fn display_name(&self) -> &str {
        match self {
            Self::SubRip => "SubRip",
            Self::ASS => "ASS",
            Self::SSA => "SSA",
            Self::PGS => "PGS",
            Self::VobSub => "VobSub",
            Self::WebVTT => "WebVTT",
            Self::TTML => "TTML",
            Self::EIA608 => "EIA-608",
            Self::EIA708 => "EIA-708",
            Self::DVBSubtitle => "DVB Subtitle",
            Self::Teletext => "Teletext",
            Self::Other(name) => name.as_str(),
        }
    }
}

impl std::fmt::Display for ContainerFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.display_name())
    }
}

impl std::fmt::Display for VideoCodec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.display_name())
    }
}

impl std::fmt::Display for AudioCodec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.display_name())
    }
}

impl std::fmt::Display for SubtitleCodec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.display_name())
    }
}
