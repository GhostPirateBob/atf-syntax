#![allow(
    clippy::field_reassign_with_default,
    clippy::manual_range_contains,
    clippy::collapsible_if,
    clippy::needless_range_loop,
    clippy::single_match
)]

pub mod aiff;
pub mod ape_container;
pub mod asf;
pub mod detector;
pub mod dsd;
pub mod elementary;
pub mod isobmff;
pub mod matroska;
pub mod mpeg_ps;
pub mod mpeg_ts;
pub mod ogg;
pub mod riff;
pub mod wavpack;

pub use detector::FormatDetector;

use crate::core::{
    error::{MediaInfoError, Result},
    models::*,
    source::Source,
    types::*,
};
use crate::tags::id3v2;

/// Identifies a file's format and hands it to the parser for that format.
pub struct ContainerParser;

impl ContainerParser {
    pub fn parse(src: &Source) -> Result<MediaReport> {
        let head = src.need(0, 4096)?;
        let mut format = FormatDetector::detect(head);

        // An ID3v2 tag in front of FLAC or ADTS audio: the format is whatever follows it.
        let mut id3_end = 0;
        if format == ContainerFormat::MP3 {
            if let Some(len) = id3v2::tag_len(head) {
                let next = FormatDetector::detect(src.need(len, 16)?);
                if matches!(next, ContainerFormat::FLAC | ContainerFormat::AAC) {
                    format = next;
                    id3_end = len;
                }
            }
        }

        let mut report = match format {
            ContainerFormat::MPEG4 | ContainerFormat::QuickTime => isobmff::parse(src),
            ContainerFormat::Matroska | ContainerFormat::WebM => matroska::parse(src),
            ContainerFormat::AVI | ContainerFormat::WAV => riff::parse(src),
            ContainerFormat::MPEGTS | ContainerFormat::BDAV => {
                mpeg_ts::MpegTsDemuxer::parse_buffer(src.whole_file()?)
            }
            ContainerFormat::MPEGPS => mpeg_ps::MpegPsDemuxer::parse_buffer(src.whole_file()?),
            ContainerFormat::Ogg => ogg::parse(src),
            ContainerFormat::ASF => asf::parse(src),
            ContainerFormat::AIFF => aiff::parse(src),
            ContainerFormat::APE => ape_container::parse(src),
            ContainerFormat::WavPack => wavpack::parse(src),
            ContainerFormat::DSF | ContainerFormat::DSDIFF => dsd::parse(src),
            ContainerFormat::FLAC => elementary::flac(src, id3_end),
            ContainerFormat::MP3 => elementary::mp3(src),
            ContainerFormat::AAC => elementary::aac(src, id3_end),
            ContainerFormat::MPC => elementary::mpc(src),
            _ => Err(MediaInfoError::UnsupportedFormat(
                "Unrecognized media container or bitstream format".to_string(),
            )),
        }?;
        report.general.file_size = src.size();
        Self::finalize(&mut report);
        Ok(report)
    }

    /// Fills in what follows from what the parsers decoded, so each one needn't repeat it.
    fn finalize(report: &mut MediaReport) {
        // MediaInfo's OverallBitRate is the whole file over the whole duration.
        if let Some(ms) = report.general.duration_ms.filter(|ms| *ms > 0.0) {
            if report.general.file_size > 0 {
                report.general.overall_bitrate =
                    Some((report.general.file_size as f64 * 8.0 / (ms / 1000.0)) as u64);
            }
        }
        // An audio file's overall mode is its one stream's.
        if report.general.overall_bitrate_mode.is_none()
            && report.videos.is_empty()
            && report.audios.len() == 1
        {
            report.general.overall_bitrate_mode = report.audios[0].bit_rate_mode;
        }

        for v in &mut report.videos {
            if v.format_version.is_none() {
                v.format_version = match v.format {
                    VideoCodec::MPEG1Video => Some("1".to_string()),
                    VideoCodec::MPEG2Video => Some("2".to_string()),
                    _ => None,
                };
            }
            if v.color_space.is_none() && !matches!(v.format, VideoCodec::ProRes) {
                let rgb = matches!(v.chroma_subsampling, Some(ChromaSubsampling::RGB));
                v.color_space = Some(if rgb { "RGB" } else { "YUV" }.to_string());
            }
            if v.display_aspect_ratio.is_none() && v.width > 0 && v.height > 0 {
                let par = v.sample_aspect_ratio.unwrap_or(1.0);
                v.display_aspect_ratio = Some((v.width as f64 * par) / v.height as f64);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_detector() {
        assert_eq!(
            FormatDetector::detect(b"\x1A\x45\xDF\xA3\x93\x42\x82\x88matroska"),
            ContainerFormat::Matroska
        );
        assert_eq!(
            FormatDetector::detect(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00"),
            ContainerFormat::MPEG4
        );
        assert_eq!(
            FormatDetector::detect(b"RIFF\x24\x00\x00\x00WAVEfmt "),
            ContainerFormat::WAV
        );
        assert_eq!(
            FormatDetector::detect(b"OggS\x00\x02\x00\x00"),
            ContainerFormat::Ogg
        );
        assert_eq!(
            FormatDetector::detect(&[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11]),
            ContainerFormat::ASF
        );
        assert_eq!(FormatDetector::detect(b"MP+"), ContainerFormat::MPC);
    }
}
