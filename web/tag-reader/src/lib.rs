//! The ATF playground's tag reader: audio and video file metadata (container, streams and tags)
//! as MediaInfo-style JSON, compiled to WebAssembly for `web/src/worker/tags.worker.ts`.
//!
//! Copied from [vuio-media-info](https://github.com/vuiodev/vuio-media-info) (MIT OR
//! Apache-2.0, partly based on MediaInfoLib: see NOTICE) and kept here so the playground builds
//! from its own source; see README.md for where it came from and how to update it.
//!
//! ```no_run
//! let json = vuio_media_info::inspect_bytes(&std::fs::read("song.flac")?)?.to_json()?;
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! A reader that has only part of a file uses [`inspect_source`] with a [`Source`] holding the
//! parts read so far; [`MediaInfoError::NeedMore`] names the next part to read. The [`abi`]
//! module wraps that for JavaScript.

pub mod abi;
pub mod audio;
pub mod container;
pub mod core;
mod json;
pub mod tags;

pub use core::error::{MediaInfoError, Result};
pub use core::models::*;
pub use core::source::Source;
pub use core::types::*;

/// Inspects a whole file held in memory.
pub fn inspect_bytes(bytes: &[u8]) -> Result<MediaReport> {
    inspect_source(&Source::whole(bytes))
}

/// Inspects whatever has been read of a file so far. When a parser needs bytes that aren't in
/// `source`, the error is [`MediaInfoError::NeedMore`] with the range to read before calling
/// again.
pub fn inspect_source(source: &Source) -> Result<MediaReport> {
    container::ContainerParser::parse(source)
}
