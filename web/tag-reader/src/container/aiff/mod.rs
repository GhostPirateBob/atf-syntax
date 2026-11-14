//! AIFF / AIFF-C: the COMM chunk for the format, ID3 / NAME / AUTH chunks for tags.

use crate::core::{
    error::{MediaInfoError, Result},
    models::*,
    source::Source,
    types::*,
};
use crate::tags::id3v2;

/// Reads an AIFF / AIFF-C file chunk by chunk; the sound data (SSND) is stepped over.
pub fn parse(src: &Source) -> Result<MediaReport> {
    let head = src.need(0, 12)?;
    if head.len() < 12 || &head[..4] != b"FORM" || !matches!(&head[8..12], b"AIFF" | b"AIFC") {
        return Err(MediaInfoError::InvalidData(
            "Not an AIFF or AIFC container".to_string(),
        ));
    }
    let is_aifc = &head[8..12] == b"AIFC";

    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::AIFF;
    if is_aifc {
        report.general.format_profile = Some("Compressed".to_string());
    }
    let mut a = AudioTrack::default();
    a.format = AudioCodec::PCM;
    a.compression_mode = Some("Lossless".to_string());
    let mut has_audio = false;
    let mut uncompressed = true;
    let mut frames = 0u32;
    let mut tags = TagSet::default();

    let size = src.size();
    let mut offset = 12u64;
    while offset + 8 <= size {
        let h = src.need(offset, 8)?;
        let id = [h[0], h[1], h[2], h[3]];
        let len = u32::from_be_bytes([h[4], h[5], h[6], h[7]]) as u64;
        let at = offset + 8;
        offset = at + len + (len & 1);
        match &id {
            b"SSND" => a.stream_size = Some(len.saturating_sub(8)),
            b"COMM" => {
                let c = src.need(at, len)?;
                if c.len() < 18 {
                    continue;
                }
                a.channels = i16::from_be_bytes([c[0], c[1]]).max(0) as u32;
                frames = u32::from_be_bytes([c[2], c[3], c[4], c[5]]);
                a.bit_depth =
                    Some(i16::from_be_bytes([c[6], c[7]]).max(0) as u8).filter(|b| *b > 0);
                a.sampling_rate = ieee_extended(&c[8..18]);
                a.channel_layout = AudioChannelLayout::from_channel_count(a.channels);
                if is_aifc && c.len() >= 22 {
                    let kind = &c[18..22];
                    a.codec_id = Some(String::from_utf8_lossy(kind).trim().to_string());
                    if matches!(kind, b"alaw" | b"ALAW" | b"ulaw" | b"ULAW") {
                        a.format = AudioCodec::Other(
                            if kind.eq_ignore_ascii_case(b"alaw") {
                                "A-Law"
                            } else {
                                "U-Law"
                            }
                            .to_string(),
                        );
                        a.compression_mode = Some("Lossy".to_string());
                        uncompressed = false;
                    } else if !matches!(
                        kind,
                        b"NONE"
                            | b"none"
                            | b"sowt"
                            | b"twos"
                            | b"fl32"
                            | b"FL32"
                            | b"fl64"
                            | b"FL64"
                            | b"in24"
                            | b"in32"
                    ) {
                        uncompressed = false;
                    }
                }
                has_audio = true;
            }
            b"ID3 " | b"id3 " => id3v2::read(src.need(at, len)?, &mut tags),
            b"NAME" | b"AUTH" | b"(c) " | b"ANNO" => {
                let text = String::from_utf8_lossy(src.need(at, len)?)
                    .trim_end_matches('\0')
                    .trim()
                    .to_string();
                let field = match &id {
                    b"NAME" => "Title",
                    b"AUTH" => "Performer",
                    b"(c) " => "Copyright",
                    _ => "Comment",
                };
                tags.push(field, &text);
            }
            _ => {}
        }
    }
    report.general.merge_tags(tags);

    if a.sampling_rate > 0 && frames > 0 {
        let ms = frames as f64 / a.sampling_rate as f64 * 1000.0;
        a.duration_ms = Some(ms);
        report.general.duration_ms = Some(ms);
        a.bit_rate = Some(match (uncompressed, a.bit_depth) {
            (true, Some(bits)) => a.sampling_rate as u64 * a.channels as u64 * bits as u64,
            _ => (size as f64 * 8.0 / (ms / 1000.0)) as u64,
        });
        a.bit_rate_mode = Some(BitrateMode::Constant);
    }
    if has_audio {
        report.audios.push(a);
    }
    Ok(report)
}

/// An 80-bit IEEE 754 extended float (AIFF's sample rate), rounded to whole Hz.
fn ieee_extended(b: &[u8]) -> u32 {
    let exponent = (((b[0] as u16 & 0x7F) << 8) | b[1] as u16) as i32;
    let mantissa = u64::from_be_bytes(b[2..10].try_into().unwrap_or([0; 8]));
    if exponent == 0 && mantissa == 0 {
        return 0;
    }
    (mantissa as f64 * 2f64.powi(exponent - 16383 - 63)).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aiff_demuxer() {
        let mut data = b"FORM".to_vec();
        data.extend_from_slice(&38u32.to_be_bytes());
        data.extend_from_slice(b"AIFF");
        data.extend_from_slice(b"COMM");
        data.extend_from_slice(&18u32.to_be_bytes());
        data.extend_from_slice(&2i16.to_be_bytes());
        data.extend_from_slice(&44100u32.to_be_bytes()); // 1 s of frames
        data.extend_from_slice(&16i16.to_be_bytes());
        data.extend_from_slice(&[0x40, 0x0E, 0xAC, 0x44, 0, 0, 0, 0, 0, 0]); // 44100.0

        let report = parse(&Source::whole(&data)).unwrap();
        assert_eq!(report.general.duration_ms, Some(1000.0));
        let a = &report.audios[0];
        assert_eq!(
            (a.channels, a.sampling_rate, a.bit_depth),
            (2, 44100, Some(16))
        );
        assert_eq!(a.bit_rate, Some(1_411_200));
    }
}
