/// Frame rate mode (constant vs variable).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FrameRateMode {
    Constant,
    Variable,
}

impl FrameRateMode {
    /// MediaInfo's JSON code for it (`FrameRate_Mode`).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Constant => "CFR",
            Self::Variable => "VFR",
        }
    }
}

/// Bit rate mode (constant vs variable).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BitrateMode {
    Constant,
    Variable,
}

impl BitrateMode {
    /// MediaInfo's JSON code for it (`BitRate_Mode`, `OverallBitRate_Mode`).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Constant => "CBR",
            Self::Variable => "VBR",
        }
    }
}
