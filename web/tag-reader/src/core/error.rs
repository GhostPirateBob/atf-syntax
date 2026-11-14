use thiserror::Error;

/// Errors from inspecting a file.
#[derive(Error, Debug)]
pub enum MediaInfoError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Unexpected EOF: expected at least {expected} bytes, but only {actual} available")]
    UnexpectedEof { expected: usize, actual: usize },

    #[error("Invalid data: {0}")]
    InvalidData(String),

    #[error("Invalid syncword: expected 0x{expected:X}, found 0x{actual:X}")]
    InvalidSyncword { expected: u32, actual: u32 },

    #[error("Unsupported format or container: {0}")]
    UnsupportedFormat(String),

    #[error("Corrupt bitstream: {0}")]
    CorruptBitstream(String),

    #[error("Bitstream reader error: {0}")]
    BitReaderError(String),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    /// The parser needs bytes `offset..offset + len` of the file, which the caller has not read
    /// yet (see [`Source`](crate::Source)). Read them and inspect again.
    #[error("Need {len} bytes at offset {offset}")]
    NeedMore { offset: u64, len: u64 },
}

pub type Result<T> = std::result::Result<T, MediaInfoError>;
