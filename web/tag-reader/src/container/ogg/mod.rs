//! Ogg (Vorbis, Opus, FLAC, Speex, Theora): the identification and comment headers from the
//! first pages, and the length from the last page's granule position.

use crate::audio::{FlacStreamInfo, OpusHead};
use crate::core::{
    error::{MediaInfoError, Result},
    models::*,
    source::Source,
    types::*,
};
use crate::tags::vorbis;

/// The header pages: identification and comments come first, and are rarely this long.
const HEAD: u64 = 64 * 1024;
/// Enough of the end to hold the last page.
const TAIL: u64 = 64 * 1024;

/// Reads an Ogg file.
pub fn parse(src: &Source) -> Result<MediaReport> {
    let head = src.need(0, HEAD)?;
    if !head.starts_with(b"OggS") {
        return Err(MediaInfoError::InvalidData(
            "Not a valid Ogg bitstream".to_string(),
        ));
    }
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::Ogg;
    let mut audio = AudioTrack::default();
    let mut has_audio = false;
    let mut tags = TagSet::default();
    // Speex's comments are a bare Vorbis comment block in the packet after its header.
    let mut speex_comments_next = false;

    let mut offset = 0;
    while offset + 27 <= head.len() {
        if &head[offset..offset + 4] != b"OggS" {
            offset += 1;
            continue;
        }
        let segments = head[offset + 26] as usize;
        let header_len = 27 + segments;
        if offset + header_len > head.len() {
            break;
        }
        let payload_len: usize = head[offset + 27..offset + header_len]
            .iter()
            .map(|&s| s as usize)
            .sum();
        let start = offset + header_len;
        // A page cut off by the end of the head still gives its first bytes (a long comment
        // packet keeps the comments before a cover picture).
        let page = &head[start..(start + payload_len).min(head.len())];
        offset = start + payload_len;

        if page.starts_with(b"OpusHead") {
            if let Ok(opus) = OpusHead::parse(page) {
                audio.format = AudioCodec::Opus;
                audio.channels = opus.channels;
                audio.channel_layout = Some(opus.channel_layout);
                audio.sampling_rate = opus.output_sample_rate;
                audio.compression_mode = Some("Lossy".to_string());
                has_audio = true;
            }
        } else if let Some(comments) = page.strip_prefix(b"OpusTags") {
            audio.encoded_library = vorbis::read(comments, &mut tags);
        } else if page.starts_with(b"\x01vorbis") && page.len() >= 29 {
            audio.format = AudioCodec::Vorbis;
            audio.channels = page[11] as u32;
            audio.channel_layout = AudioChannelLayout::from_channel_count(audio.channels);
            audio.sampling_rate = u32::from_le_bytes([page[12], page[13], page[14], page[15]]);
            let nominal = i32::from_le_bytes([page[20], page[21], page[22], page[23]]);
            if nominal > 0 {
                audio.bit_rate = Some(nominal as u64);
            }
            audio.bit_rate_mode = Some(BitrateMode::Variable);
            audio.compression_mode = Some("Lossy".to_string());
            has_audio = true;
        } else if let Some(comments) = page.strip_prefix(b"\x03vorbis") {
            audio.encoded_library = vorbis::read(comments, &mut tags);
        } else if page.starts_with(b"\x7fFLAC") {
            // A 9-byte mapping header and `fLaC`, then the native STREAMINFO block.
            audio.format = AudioCodec::FLAC;
            audio.compression_mode = Some("Lossless".to_string());
            audio.bit_rate_mode = Some(BitrateMode::Variable);
            if let Some(info) = page.get(13..).and_then(|b| FlacStreamInfo::parse(b).ok()) {
                audio.sampling_rate = info.sample_rate;
                audio.channels = info.channels;
                audio.channel_layout = Some(info.channel_layout);
                audio.bit_depth = Some(info.bit_depth);
            }
            has_audio = true;
        } else if audio.format == AudioCodec::FLAC && page.first().is_some_and(|b| b & 0x7F == 4) {
            // Ogg FLAC's comment packet is a bare VORBIS_COMMENT metadata block.
            audio.encoded_library = vorbis::read(page.get(4..).unwrap_or(&[]), &mut tags);
        } else if page.starts_with(b"Speex   ") {
            audio.format = AudioCodec::Other("Speex".to_string());
            if page.len() >= 52 {
                audio.sampling_rate = u32::from_le_bytes([page[36], page[37], page[38], page[39]]);
                audio.channels = u32::from_le_bytes([page[48], page[49], page[50], page[51]]);
                audio.channel_layout = AudioChannelLayout::from_channel_count(audio.channels);
            }
            has_audio = true;
            speex_comments_next = true;
        } else if speex_comments_next {
            speex_comments_next = false;
            audio.encoded_library = vorbis::read(page, &mut tags);
        } else if page.starts_with(b"\x80theora") {
            report.videos.push(theora(page));
        }
    }
    report.general.merge_tags(tags);

    // The last page's granule position: samples for audio streams.
    let tail = src.need_tail(TAIL)?;
    let mut last_granule = None;
    for i in (0..tail.len().saturating_sub(27)).rev() {
        if &tail[i..i + 4] == b"OggS" {
            let granule = u64::from_le_bytes(tail[i + 6..i + 14].try_into().unwrap_or([0; 8]));
            if granule > 0 && granule != u64::MAX {
                last_granule = Some(granule);
                break;
            }
        }
    }
    if let (Some(granule), true) = (last_granule, audio.sampling_rate > 0) {
        let ms = granule as f64 / audio.sampling_rate as f64 * 1000.0;
        if ms > 0.0 {
            report.general.duration_ms = Some(ms);
            audio.duration_ms = Some(ms);
            if audio.bit_rate.is_none() {
                audio.bit_rate = Some((src.size() as f64 * 8.0 / (ms / 1000.0)) as u64);
            }
        }
    }

    if has_audio {
        report.audios.push(audio);
    }
    Ok(report)
}

/// A Theora identification header.
fn theora(page: &[u8]) -> VideoTrack {
    let mut v = VideoTrack::default();
    v.format = VideoCodec::Theora;
    v.bit_depth = 8;
    let be24 = |i: usize| {
        page.get(i..i + 3)
            .map(|b| u32::from_be_bytes([0, b[0], b[1], b[2]]))
    };
    let be32 = |i: usize| {
        page.get(i..i + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    };
    // PICW / PICH, the frame rate and the pixel aspect ratio.
    v.width = be24(14).unwrap_or(0);
    v.height = be24(17).unwrap_or(0);
    if let (Some(num), Some(den)) = (be32(22), be32(26)) {
        if den > 0 {
            v.frame_rate = Some(num as f64 / den as f64);
        }
    }
    if let (Some(n), Some(d)) = (be24(30), be24(33)) {
        if n > 0 && d > 0 {
            v.sample_aspect_ratio = Some(n as f64 / d as f64);
        }
    }
    if let Some(rate) = be24(37).filter(|r| *r > 0) {
        v.bit_rate = Some(rate as u64);
    }
    v.chroma_subsampling = match page.get(41).map(|b| (b >> 3) & 0x03) {
        Some(2) => Some(ChromaSubsampling::YUV422),
        Some(3) => Some(ChromaSubsampling::YUV444),
        _ => Some(ChromaSubsampling::YUV420),
    };
    v
}
