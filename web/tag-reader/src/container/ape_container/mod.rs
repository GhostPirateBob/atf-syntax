//! Monkey's Audio (`.ape`): the descriptor / header at the start, APEv2 tags at the end.

use crate::container::elementary::read_trailing_tags;
use crate::core::{
    error::{MediaInfoError, Result},
    models::*,
    source::Source,
    types::*,
};

pub fn parse(src: &Source) -> Result<MediaReport> {
    let data = src.need(0, 128)?;
    if data.len() < 32 || !data.starts_with(b"MAC ") {
        return Err(MediaInfoError::InvalidData(
            "Not a valid Monkey's Audio file".to_string(),
        ));
    }
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::APE;
    let version = u16::from_le_bytes([data[4], data[5]]);
    report.general.format_version = Some(format!("{:.2}", version as f64 / 1000.0));

    let mut set_v1 = TagSet::default();
    read_trailing_tags(src, &mut report.general, &mut set_v1)?;
    report.general.merge_tags(set_v1);

    let mut a = AudioTrack::default();
    a.format = AudioCodec::MonkeyAudio;
    a.compression_mode = Some("Lossless".to_string());
    a.bit_rate_mode = Some(BitrateMode::Variable);

    let le16 = |i: usize| u16::from_le_bytes([data[i], data[i + 1]]);
    let le32 =
        |i: usize| u32::from_le_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as u64;
    // (compression level, blocks per frame, final frame blocks, total frames)
    let layout = if version >= 3980 {
        // New layout: a descriptor (its size at +8), then the header.
        let h = (le32(8) as usize).max(52);
        (h + 24 <= data.len()).then(|| {
            a.bit_depth = Some(le16(h + 16) as u8);
            a.channels = le16(h + 18) as u32;
            a.sampling_rate = le32(h + 20) as u32;
            (le16(h), le32(h + 4), le32(h + 8), le32(h + 12))
        })
    } else {
        // Before 3.98 the header follows the magic directly.
        a.channels = le16(10) as u32;
        a.sampling_rate = le32(12) as u32;
        a.bit_depth = Some(16);
        let level = le16(6);
        let per_frame = if version >= 3950 {
            73728 * 4
        } else if version >= 3900 || (version >= 3800 && level == 4000) {
            73728
        } else {
            9216
        };
        Some((level, per_frame, le32(28), le32(24)))
    };
    a.channel_layout = AudioChannelLayout::from_channel_count(a.channels);

    if let Some((level, per_frame, final_blocks, frames)) = layout {
        a.format_profile = Some(
            match level {
                1000 => "Fast",
                2000 => "Normal",
                3000 => "High",
                4000 => "Extra High",
                5000 => "Insane",
                _ => "",
            }
            .to_string(),
        )
        .filter(|s| !s.is_empty());
        if frames > 0 && a.sampling_rate > 0 {
            let samples = (frames - 1) * per_frame + final_blocks;
            let ms = samples as f64 / a.sampling_rate as f64 * 1000.0;
            a.duration_ms = Some(ms);
            a.bit_rate = Some((src.size() as f64 * 8.0 / (ms / 1000.0)) as u64);
            report.general.duration_ms = Some(ms);
        }
    }
    report.audios.push(a);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ape_container_demuxer() {
        let mut data = b"MAC ".to_vec();
        data.extend_from_slice(&3990u16.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&52u32.to_le_bytes()); // descriptor bytes
        data.extend_from_slice(&24u32.to_le_bytes()); // header bytes
        data.extend_from_slice(&[0u8; 36]);
        data.extend_from_slice(&2000u16.to_le_bytes()); // Normal
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&44100u32.to_le_bytes()); // blocks per frame
        data.extend_from_slice(&44100u32.to_le_bytes()); // final frame blocks
        data.extend_from_slice(&10u32.to_le_bytes()); // frames
        data.extend_from_slice(&16u16.to_le_bytes());
        data.extend_from_slice(&2u16.to_le_bytes());
        data.extend_from_slice(&44100u32.to_le_bytes());

        let report = parse(&Source::whole(&data)).unwrap();
        assert_eq!(report.general.duration_ms, Some(10000.0));
        let a = &report.audios[0];
        assert_eq!(
            (a.channels, a.sampling_rate, a.bit_depth),
            (2, 44100, Some(16))
        );
        assert_eq!(a.format_profile.as_deref(), Some("Normal"));
    }
}
