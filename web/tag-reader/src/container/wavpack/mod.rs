//! WavPack (`.wv`): the first block header, APEv2 tags at the end.

use crate::container::elementary::read_trailing_tags;
use crate::core::{
    error::{MediaInfoError, Result},
    models::*,
    source::Source,
    types::*,
};

const SAMPLE_RATES: [u32; 15] = [
    6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000,
    192000,
];

pub fn parse(src: &Source) -> Result<MediaReport> {
    let data = src.need(0, 32)?;
    if data.len() < 32 || !data.starts_with(b"wvpk") {
        return Err(MediaInfoError::InvalidData(
            "Not a valid WavPack file".to_string(),
        ));
    }
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::WavPack;
    let version = u16::from_le_bytes([data[8], data[9]]);
    report.general.format_version = Some(format!("{}.{}", version >> 8, version & 0xFF));

    let mut set_v1 = TagSet::default();
    read_trailing_tags(src, &mut report.general, &mut set_v1)?;
    report.general.merge_tags(set_v1);

    let total_samples = u32::from_le_bytes([data[12], data[13], data[14], data[15]]);
    let flags = u32::from_le_bytes([data[24], data[25], data[26], data[27]]);
    let mono = flags & (1 << 2) != 0;
    let hybrid = flags & (1 << 3) != 0;

    let mut a = AudioTrack::default();
    a.format = AudioCodec::WavPack;
    a.compression_mode = Some(if hybrid { "Lossy" } else { "Lossless" }.to_string());
    a.bit_rate_mode = Some(BitrateMode::Variable);
    a.channels = if mono { 1 } else { 2 };
    a.channel_layout = AudioChannelLayout::from_channel_count(a.channels);
    a.sampling_rate = SAMPLE_RATES
        .get(((flags >> 23) & 0x0F) as usize)
        .copied()
        .unwrap_or(0);
    a.bit_depth = Some(((flags & 0x03) as u8 + 1) * 8);

    if total_samples > 0 && total_samples != u32::MAX && a.sampling_rate > 0 {
        let ms = total_samples as f64 / a.sampling_rate as f64 * 1000.0;
        a.duration_ms = Some(ms);
        a.bit_rate = Some((src.size() as f64 * 8.0 / (ms / 1000.0)) as u64);
        report.general.duration_ms = Some(ms);
    }
    report.audios.push(a);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wavpack_demuxer() {
        let mut data = vec![0u8; 32];
        data[0..4].copy_from_slice(b"wvpk");
        data[8..10].copy_from_slice(&0x0410u16.to_le_bytes());
        data[12..16].copy_from_slice(&441000u32.to_le_bytes());
        data[24..28].copy_from_slice(&(1u32 | (9 << 23)).to_le_bytes()); // 16-bit, stereo, 44.1 kHz

        let report = parse(&Source::whole(&data)).unwrap();
        assert_eq!(report.general.duration_ms, Some(10000.0));
        let a = &report.audios[0];
        assert_eq!(
            (a.channels, a.sampling_rate, a.bit_depth),
            (2, 44100, Some(16))
        );
    }
}
