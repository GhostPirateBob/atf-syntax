//! Audio files that are a bare elementary stream plus tags: MP3, FLAC, ADTS AAC and Musepack.

use crate::audio::{AacInfo, FlacStreamInfo, MpegaHeader, mpega};
use crate::core::{error::Result, models::*, source::Source, types::*};
use crate::tags::{ape, id3v1, id3v2, vorbis};

/// How far past the ID3v2 tag to look for the first MPEG audio frame.
const SYNC_SCAN: u64 = 64 * 1024;

/// Reads the tags at the end of a file: ID3v1 (the last 128 bytes), then an APE tag in front of
/// it or at the very end. Returns where the audio stops.
pub(crate) fn read_trailing_tags(
    src: &Source,
    general: &mut GeneralTrack,
    set_v1: &mut TagSet,
) -> Result<u64> {
    let size = src.size();
    let mut end = size;
    if size >= 128 && id3v1::read(src.need(size - 128, 128)?, set_v1) {
        end -= 128;
    }
    let mut set_ape = TagSet::default();
    if let Some(start) = ape::read(src, end, &mut set_ape)? {
        end = start;
    }
    general.merge_tags(set_ape);
    Ok(end)
}

pub fn mp3(src: &Source) -> Result<MediaReport> {
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::MP3;
    let size = src.size();

    // ID3v2 first: MediaInfo prefers it to APE, and APE to ID3v1.
    let mut start = 0;
    if let Some(len) = id3v2::tag_len(src.need(0, 10)?) {
        let mut set = TagSet::default();
        id3v2::read(src.need(0, len)?, &mut set);
        report.general.merge_tags(set);
        start = len.min(size);
    }
    let mut set_v1 = TagSet::default();
    let end = read_trailing_tags(src, &mut report.general, &mut set_v1)?.max(start);
    report.general.merge_tags(set_v1);

    // The first frame: a plausible header whose successor (when it is in view) also syncs.
    let window = src.need(start, SYNC_SCAN.min(end - start))?;
    let mut found = None;
    for i in 0..window.len().saturating_sub(4) {
        if !mpega::is_frame_header(&window[i..]) {
            continue;
        }
        let Ok(header) = MpegaHeader::parse(&window[i..]) else {
            continue;
        };
        let next = i + header.frame_size;
        if header.frame_size > 0
            && next + 4 <= window.len()
            && !mpega::is_frame_header(&window[next..])
        {
            continue;
        }
        found = Some((i as u64, header));
        break;
    }
    let Some((offset, header)) = found else {
        return Ok(report);
    };

    let mut a = AudioTrack::default();
    a.format = match header.layer {
        "Layer 1" => AudioCodec::MPEGAudioLayer1,
        "Layer 2" => AudioCodec::MPEGAudioLayer2,
        _ => AudioCodec::MPEGAudioLayer3,
    };
    a.sampling_rate = header.sample_rate;
    a.channels = header.channels;
    a.channel_layout = Some(header.channel_layout.clone());
    a.compression_mode = Some("Lossy".to_string());

    let audio_bytes = end.saturating_sub(start + offset);
    // A Xing / Info header lives in a frame of its own, often coded at a lower rate than the
    // music; a CBR file's real rate is the next frame's.
    let cbr_rate = window
        .get(offset as usize + header.frame_size..)
        .filter(|next| {
            header.xing_frames.is_some() && header.frame_size > 0 && mpega::is_frame_header(next)
        })
        .and_then(|next| MpegaHeader::parse(next).ok())
        .map_or(header.bit_rate, |next| next.bit_rate);
    let (duration_ms, bit_rate) = match header
        .xing_frames
        .filter(|f| *f > 0 && header.sample_rate > 0)
    {
        Some(frames) => {
            let ms = frames as f64 * header.samples_per_frame as f64 / header.sample_rate as f64
                * 1000.0;
            let bytes = header.xing_bytes.map_or(audio_bytes, u64::from);
            let rate = if header.is_vbr {
                (bytes as f64 * 8.0 / (ms / 1000.0)) as u64
            } else {
                cbr_rate
            };
            (ms, rate)
        }
        None if header.bit_rate > 0 => (
            audio_bytes as f64 * 8.0 / header.bit_rate as f64 * 1000.0,
            header.bit_rate,
        ),
        None => (0.0, 0),
    };
    if duration_ms > 0.0 {
        a.duration_ms = Some(duration_ms);
        report.general.duration_ms = Some(duration_ms);
    }
    if bit_rate > 0 {
        a.bit_rate = Some(bit_rate);
    }
    let mode = if header.is_vbr {
        BitrateMode::Variable
    } else {
        BitrateMode::Constant
    };
    a.bit_rate_mode = Some(mode);
    report.general.overall_bitrate_mode = Some(mode);

    // The encoder string in the Xing / Info frame is what MediaInfo reports as the library
    // (it wins over an ID3v2 TSSE).
    if let Some(enc) = header.encoder {
        report
            .general
            .tags
            .insert("Encoded_Library".to_string(), enc.clone());
        a.encoded_library = Some(enc);
    } else if let Some(enc) = report.general.tag("Encoded_Library") {
        a.encoded_library = Some(enc.to_string());
    }
    report.audios.push(a);
    Ok(report)
}

/// FLAC, from its `fLaC` marker at `start` (past any ID3v2 tag): metadata blocks, then frames.
pub fn flac(src: &Source, start: u64) -> Result<MediaReport> {
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::FLAC;
    if start > 0 {
        let mut set = TagSet::default();
        id3v2::read(src.need(0, start)?, &mut set);
        report.general.merge_tags(set);
    }

    let mut a = AudioTrack::default();
    a.format = AudioCodec::FLAC;
    a.compression_mode = Some("Lossless".to_string());
    a.bit_rate_mode = Some(BitrateMode::Variable);

    let mut offset = start + 4;
    let mut info = None;
    let mut set = TagSet::default();
    loop {
        let header = src.need(offset, 4)?;
        if header.len() < 4 {
            break;
        }
        let last = header[0] & 0x80 != 0;
        let kind = header[0] & 0x7F;
        let len = u32::from_be_bytes([0, header[1], header[2], header[3]]) as u64;
        match kind {
            0 => info = FlacStreamInfo::parse(src.need(offset + 4, len)?).ok(),
            4 => a.encoded_library = vorbis::read(src.need(offset + 4, len)?, &mut set),
            6 => set.set("Cover", "Yes"),
            _ => {} // padding, seek table, application data: skipped, never read
        }
        offset += 4 + len;
        if last || offset >= src.size() {
            break;
        }
    }
    report.general.merge_tags(set);

    if let Some(info) = info {
        a.sampling_rate = info.sample_rate;
        a.channels = info.channels;
        a.channel_layout = Some(info.channel_layout);
        a.bit_depth = Some(info.bit_depth);
        if info.duration_ms > 0.0 {
            a.duration_ms = Some(info.duration_ms);
            report.general.duration_ms = Some(info.duration_ms);
            // The frames run from the end of the metadata to the end of the file.
            let audio = src.size().saturating_sub(offset);
            a.stream_size = Some(audio);
            a.bit_rate = Some((audio as f64 * 8.0 / (info.duration_ms / 1000.0)) as u64);
        }
    }
    report.audios.push(a);
    Ok(report)
}

/// ADTS AAC, from the first frame at `start`. The bit rate comes from that frame alone.
pub fn aac(src: &Source, start: u64) -> Result<MediaReport> {
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::AAC;
    if start > 0 {
        let mut set = TagSet::default();
        id3v2::read(src.need(0, start)?, &mut set);
        report.general.merge_tags(set);
    }
    let mut set_v1 = TagSet::default();
    let end = read_trailing_tags(src, &mut report.general, &mut set_v1)?;
    report.general.merge_tags(set_v1);

    let aac = AacInfo::parse_adts(src.need(start, 16)?)?;

    let mut a = AudioTrack::default();
    a.format = AudioCodec::AAC;
    a.format_profile = Some(aac.profile.to_string());
    a.sampling_rate = aac.sampling_rate;
    a.channels = aac.channels;
    a.channel_layout = Some(aac.channel_layout);
    a.compression_mode = Some("Lossy".to_string());
    a.bit_rate_mode = Some(BitrateMode::Variable);

    // ADTS has no header for the length: average the frames already read (each 1024 samples)
    // for a bit rate, and estimate the length from the file size.
    let frames = src.available(start, end.saturating_sub(start));
    let (mut count, mut bytes, mut pos) = (0u64, 0u64, 0usize);
    while let Some(h) = frames.get(pos..pos + 7) {
        let len =
            (((h[3] & 0x03) as usize) << 11) | ((h[4] as usize) << 3) | ((h[5] >> 5) as usize);
        if h[0] != 0xFF || h[1] & 0xF6 != 0xF0 || len < 7 || pos + len > frames.len() {
            break;
        }
        count += 1;
        bytes += len as u64;
        pos += len;
    }
    if count > 0 && aac.sampling_rate > 0 {
        let rate = bytes * 8 * aac.sampling_rate as u64 / (count * 1024);
        a.bit_rate = Some(rate);
        let ms = end.saturating_sub(start) as f64 * 8.0 / rate as f64 * 1000.0;
        a.duration_ms = Some(ms);
        report.general.duration_ms = Some(ms);
    }
    report.audios.push(a);
    Ok(report)
}

/// Musepack: the SV7 header, and APEv2 tags at the end.
pub fn mpc(src: &Source) -> Result<MediaReport> {
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::MPC;
    let mut set_v1 = TagSet::default();
    read_trailing_tags(src, &mut report.general, &mut set_v1)?;
    report.general.merge_tags(set_v1);

    let mut a = AudioTrack::default();
    a.format = AudioCodec::MPC;
    a.compression_mode = Some("Lossy".to_string());
    a.bit_rate_mode = Some(BitrateMode::Variable);
    let head = src.need(0, 28)?;
    if head.starts_with(b"MP+") && head.len() >= 28 {
        let frames = u32::from_le_bytes([head[4], head[5], head[6], head[7]]);
        let sample_rate = [44100, 48000, 37800, 32000][(head[10] & 0x03) as usize];
        a.sampling_rate = sample_rate;
        a.channels = 2;
        a.channel_layout = Some(AudioChannelLayout::Stereo);
        let ms = frames as f64 * 1152.0 / sample_rate as f64 * 1000.0;
        if ms > 0.0 {
            a.duration_ms = Some(ms);
            a.bit_rate = Some((src.size() as f64 * 8.0 / (ms / 1000.0)) as u64);
            report.general.duration_ms = Some(ms);
        }
    }
    report.audios.push(a);
    Ok(report)
}
