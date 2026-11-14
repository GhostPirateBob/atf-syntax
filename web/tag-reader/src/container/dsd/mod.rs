//! Direct Stream Digital: DSF (Sony) and DSDIFF (Philips).

use crate::core::{
    error::{MediaInfoError, Result},
    models::*,
    source::Source,
    types::*,
};
use crate::tags::id3v2;

pub fn parse(src: &Source) -> Result<MediaReport> {
    let head = src.need(0, 16)?;
    if head.starts_with(b"DSD ") {
        dsf(src)
    } else if head.starts_with(b"FRM8") {
        dsdiff(src)
    } else {
        Err(MediaInfoError::InvalidData(
            "Not a valid DSD file".to_string(),
        ))
    }
}

/// The DSD rate's usual name (DSD64 is 64 x 44.1 kHz).
fn rate_name(rate: u32) -> Option<String> {
    (rate > 0 && rate.is_multiple_of(44100)).then(|| format!("DSD{}", rate / 44100))
}

fn finish(a: &mut AudioTrack) {
    a.format = AudioCodec::DSD;
    a.bit_depth = Some(1);
    a.compression_mode
        .get_or_insert_with(|| "Lossless".to_string());
    a.format_profile = rate_name(a.sampling_rate);
    a.channel_layout = AudioChannelLayout::from_channel_count(a.channels);
    if a.sampling_rate > 0 && a.channels > 0 {
        a.bit_rate = Some(a.sampling_rate as u64 * a.channels as u64);
        a.bit_rate_mode = Some(BitrateMode::Constant);
    }
}

/// DSF: a 28-byte DSD chunk (with the metadata offset), the fmt chunk, then data. Tags are an
/// ID3v2 tag at the metadata offset, at the end of the file.
fn dsf(src: &Source) -> Result<MediaReport> {
    let d = src.need(0, 80)?;
    if d.len() < 80 || &d[28..32] != b"fmt " {
        return Err(MediaInfoError::InvalidData(
            "Missing DSF fmt chunk".to_string(),
        ));
    }
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::DSF;
    let le32 = |i: usize| u32::from_le_bytes([d[i], d[i + 1], d[i + 2], d[i + 3]]);
    let le64 = |i: usize| u64::from_le_bytes(d[i..i + 8].try_into().unwrap_or([0; 8]));

    let mut a = AudioTrack::default();
    a.channels = le32(52);
    a.sampling_rate = le32(56);
    let samples = le64(64);
    finish(&mut a);
    if a.sampling_rate > 0 && samples > 0 {
        let ms = samples as f64 / a.sampling_rate as f64 * 1000.0;
        a.duration_ms = Some(ms);
        report.general.duration_ms = Some(ms);
    }

    let metadata = le64(20);
    if metadata > 0 && metadata < src.size() {
        if let Some(len) = id3v2::tag_len(src.need(metadata, 10)?) {
            let mut set = TagSet::default();
            id3v2::read(src.need(metadata, len)?, &mut set);
            report.general.merge_tags(set);
        }
    }
    report.audios.push(a);
    Ok(report)
}

/// DSDIFF: `FRM8`, a 64-bit size, `DSD `, then chunks with 64-bit big-endian sizes.
fn dsdiff(src: &Source) -> Result<MediaReport> {
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::DSDIFF;
    let mut a = AudioTrack::default();
    let mut sound_bytes = 0u64;
    let mut tags = TagSet::default();

    let size = src.size();
    let mut offset = 16u64;
    while offset + 12 <= size {
        let h = src.need(offset, 12)?;
        let id = [h[0], h[1], h[2], h[3]];
        let len = u64::from_be_bytes(h[4..12].try_into().unwrap_or([0; 8]));
        let at = offset + 12;
        match &id {
            b"PROP" => {
                let p = src.need(at, len)?;
                if p.starts_with(b"SND ") {
                    read_prop(&p[4..], &mut a);
                }
            }
            b"DSD " => sound_bytes = len,
            b"DST " => {
                sound_bytes = len;
                a.compression_mode = Some("Lossless (DST)".to_string());
            }
            b"ID3 " => id3v2::read(src.need(at, len)?, &mut tags),
            _ => {}
        }
        offset = match at.checked_add(len + (len & 1)) {
            Some(next) => next,
            None => break,
        };
    }
    report.general.merge_tags(tags);
    finish(&mut a);
    // Uncompressed DSD is one bit per sample per channel.
    if a.compression_mode.as_deref() == Some("Lossless")
        && a.sampling_rate > 0
        && a.channels > 0
        && sound_bytes > 0
    {
        let ms = sound_bytes as f64 * 8.0 / (a.sampling_rate as f64 * a.channels as f64) * 1000.0;
        a.duration_ms = Some(ms);
        report.general.duration_ms = Some(ms);
    }
    report.audios.push(a);
    Ok(report)
}

fn read_prop(mut p: &[u8], a: &mut AudioTrack) {
    while p.len() >= 12 {
        let id = &p[..4];
        let len = u64::from_be_bytes(p[4..12].try_into().unwrap_or([0; 8])) as usize;
        let Some(body) = p.get(12..12 + len) else {
            break;
        };
        match id {
            b"FS  " if body.len() >= 4 => {
                a.sampling_rate = u32::from_be_bytes([body[0], body[1], body[2], body[3]])
            }
            b"CHNL" if body.len() >= 2 => {
                a.channels = u16::from_be_bytes([body[0], body[1]]) as u32
            }
            _ => {}
        }
        p = p.get(12 + len + (len & 1)..).unwrap_or(&[]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dsf() {
        let mut data = b"DSD ".to_vec();
        data.extend_from_slice(&28u64.to_le_bytes());
        data.extend_from_slice(&92u64.to_le_bytes());
        data.extend_from_slice(&0u64.to_le_bytes()); // no metadata
        data.extend_from_slice(b"fmt ");
        data.extend_from_slice(&52u64.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&2u32.to_le_bytes());
        data.extend_from_slice(&2u32.to_le_bytes()); // channels
        data.extend_from_slice(&2822400u32.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&28224000u64.to_le_bytes()); // 10 s
        data.extend_from_slice(&4096u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());

        let report = parse(&Source::whole(&data)).unwrap();
        assert_eq!(report.general.duration_ms, Some(10000.0));
        let a = &report.audios[0];
        assert_eq!(
            (a.channels, a.sampling_rate, a.bit_depth),
            (2, 2822400, Some(1))
        );
        assert_eq!(a.format_profile.as_deref(), Some("DSD64"));
    }
}
