//! Matroska / WebM (`.mkv`, `.mka`, `.webm`).
//!
//! The segment's own header elements (Info, Tracks, Tags) are read; clusters (the frames) are
//! only looked at while they are already in memory. Tags written after the clusters are found
//! through the SeekHead rather than by walking every cluster to reach them.

use crate::audio::{AacInfo, Ac3Header, DtsHeader, FlacStreamInfo, OpusHead};
use crate::core::{bitstream::EbmlVint, error::Result, models::*, source::Source, types::*};
use crate::tags::push_named;
use crate::video::{AvcSps, HevcSps};
use std::collections::{HashMap, HashSet};

const EBML: u32 = 0x1A45DFA3;
const SEGMENT: u32 = 0x18538067;
const SEEK_HEAD: u32 = 0x114D9B74;
const INFO: u32 = 0x1549A966;
const TRACKS: u32 = 0x1654AE6B;
const TAGS: u32 = 0x1254C367;
const CLUSTER: u32 = 0x1F43B675;

/// Reads an EBML unsigned integer, which is stored in the fewest bytes that fit it.
fn ebml_uint(payload: &[u8]) -> Option<u64> {
    if payload.is_empty() || payload.len() > 8 {
        return None;
    }
    Some(payload.iter().fold(0u64, |acc, &b| (acc << 8) | b as u64))
}

fn ebml_float(payload: &[u8]) -> Option<f64> {
    match payload.len() {
        4 => Some(f32::from_be_bytes(payload.try_into().ok()?) as f64),
        8 => Some(f64::from_be_bytes(payload.try_into().ok()?)),
        _ => None,
    }
}

/// The child elements laid end to end in `data`: (id, payload). Stops at the first malformed
/// header, or at an element running past the end.
fn children(data: &[u8]) -> impl Iterator<Item = (u32, &[u8])> {
    let mut offset = 0usize;
    std::iter::from_fn(move || {
        let (id, id_len) = EbmlVint::read_element_id(data, offset).ok()?;
        let (size, size_len) = EbmlVint::read_element_size(data, offset + id_len).ok()?;
        let start = offset + id_len + size_len;
        let end = start.checked_add(size.unwrap_or(0) as usize)?;
        let payload = data.get(start..end)?;
        offset = end;
        Some((id, payload))
    })
}

/// An element header in the file: (id, payload size if known, header length). `None` when the
/// bytes there aren't a valid header.
fn header_at(src: &Source, offset: u64) -> Result<Option<(u32, Option<u64>, u64)>> {
    let bytes = src.need(offset, 12)?;
    let Ok((id, id_len)) = EbmlVint::read_element_id(bytes, 0) else {
        return Ok(None);
    };
    let Ok((size, size_len)) = EbmlVint::read_element_size(bytes, id_len) else {
        return Ok(None);
    };
    Ok(Some((id, size, (id_len + size_len) as u64)))
}

/// Reads a Matroska or WebM file.
pub fn parse(src: &Source) -> Result<MediaReport> {
    let mut report = MediaReport::new();
    report.general.format = ContainerFormat::Matroska;
    let size = src.size();

    let mut offset = 0u64;
    while offset < size {
        let Some((id, len, header)) = header_at(src, offset)? else {
            break;
        };
        let payload = offset + header;
        let len = len.unwrap_or(size - payload.min(size));
        match id {
            EBML => {
                for (cid, value) in children(src.need(payload, len)?) {
                    // DocType
                    if cid == 0x4282
                        && String::from_utf8_lossy(value)
                            .trim()
                            .eq_ignore_ascii_case("webm")
                    {
                        report.general.format = ContainerFormat::WebM;
                    }
                }
            }
            SEGMENT => {
                Segment::new(payload, len.min(size - payload)).read(src, &mut report)?;
                break;
            }
            _ => {}
        }
        offset = payload.saturating_add(len);
    }
    Ok(report)
}

struct Segment {
    start: u64,
    end: u64,
    timecode_scale: u64,
    seen: HashSet<u32>,
    seeks: HashMap<u32, u64>,
    /// TrackUID -> TrackNumber, for tags that target a track.
    track_uids: HashMap<u64, u32>,
    track_bytes: HashMap<u32, u64>,
    probed: HashSet<u32>,
}

impl Segment {
    fn new(start: u64, len: u64) -> Self {
        Self {
            start,
            end: start + len,
            timecode_scale: 1_000_000,
            seen: HashSet::new(),
            seeks: HashMap::new(),
            track_uids: HashMap::new(),
            track_bytes: HashMap::new(),
            probed: HashSet::new(),
        }
    }

    fn read(mut self, src: &Source, report: &mut MediaReport) -> Result<()> {
        let mut tags: Vec<&[u8]> = Vec::new();
        let mut walked_to_end = true;
        let whole_file = src.get(0, src.size()).is_some();
        let large = src.size() > 8 * 1024 * 1024;

        let mut offset = self.start;
        while offset < self.end {
            let Some((id, len, header)) = header_at(src, offset)? else {
                break;
            };
            let payload = offset + header;
            match (id, len) {
                (SEEK_HEAD, Some(len)) => self.read_seek_head(src.need(payload, len)?),
                (INFO, Some(len)) => self.read_info(src.need(payload, len)?, report),
                (TRACKS, Some(len)) => self.read_tracks(src.need(payload, len)?, report),
                (TAGS, Some(len)) => tags.push(src.need(payload, len)?),
                (CLUSTER, Some(len)) => match src.get(payload, len) {
                    // Frames are only counted while they are in memory; a reader that started
                    // from the head and tail stops here and finds the rest by the SeekHead.
                    Some(cluster) => {
                        let all_probed = !report.videos.is_empty()
                            && self.probed.len() >= report.videos.len() + report.audios.len();
                        if !(large && all_probed && offset - self.start > 4 * 1024 * 1024) {
                            self.read_cluster(cluster, report);
                        }
                    }
                    None => {
                        // Its first blocks are usually in the head already: enough to probe the
                        // AC-3 / DTS frame headers for their bit rates.
                        self.read_cluster(src.available(payload, len), report);
                        walked_to_end = false;
                        break;
                    }
                },
                // Blocks of a live (unknown-size) cluster sit directly in the segment.
                (0xA3 | 0xA0, Some(len)) => {
                    if let Some(bytes) = src.get(offset, header + len) {
                        self.read_cluster(bytes, report);
                    }
                }
                _ => {}
            }
            self.seen.insert(id);
            offset = match len {
                Some(len) => payload.saturating_add(len),
                None => payload, // an unknown-size element's children follow at this level
            };
        }

        // Header elements the walk didn't reach (written after the clusters), by their seeks.
        for id in [INFO, TRACKS, TAGS] {
            if self.seen.contains(&id) {
                continue;
            }
            let Some(&pos) = self.seeks.get(&id) else {
                continue;
            };
            let at = self.start + pos;
            let Some((found, Some(len), header)) = header_at(src, at)? else {
                continue;
            };
            if found != id {
                continue;
            }
            let payload = src.need(at + header, len)?;
            match id {
                INFO => self.read_info(payload, report),
                TRACKS => self.read_tracks(payload, report),
                _ => tags.push(payload),
            }
        }

        for payload in tags {
            self.read_tags(payload, report);
        }
        if walked_to_end && whole_file {
            self.apply_track_sizes(report);
        }
        Ok(())
    }

    fn read_seek_head(&mut self, data: &[u8]) {
        for (id, seek) in children(data) {
            if id != 0x4DBB {
                continue;
            }
            let mut target = None;
            let mut pos = None;
            for (cid, value) in children(seek) {
                match cid {
                    0x53AB => target = ebml_uint(value).map(|v| v as u32),
                    0x53AC => pos = ebml_uint(value),
                    _ => {}
                }
            }
            if let (Some(target), Some(pos)) = (target, pos) {
                self.seeks.entry(target).or_insert(pos);
            }
        }
    }

    fn read_info(&mut self, data: &[u8], report: &mut MediaReport) {
        let mut duration = None;
        let mut set = TagSet::default();
        for (id, value) in children(data) {
            match id {
                0x2AD7B1 => {
                    if let Some(v) = ebml_uint(value).filter(|v| *v > 0) {
                        self.timecode_scale = v;
                    }
                }
                0x4489 => duration = ebml_float(value),
                0x7BA9 => set.push("Title", &String::from_utf8_lossy(value)),
                0x4D80 => set.push("Encoded_Library", &String::from_utf8_lossy(value)),
                0x5741 => set.push("Encoded_Application", &String::from_utf8_lossy(value)),
                _ => {}
            }
        }
        // Tags read later (a TITLE tag) take precedence over the segment title.
        for (field, value) in set.0 {
            report.general.tags.insert(field, value);
        }
        if let Some(d) = duration.filter(|d| *d > 0.0) {
            report.general.duration_ms = Some(d * self.timecode_scale as f64 / 1_000_000.0);
        }
    }

    fn read_tracks(&mut self, data: &[u8], report: &mut MediaReport) {
        for (id, entry) in children(data) {
            if id == 0xAE {
                let (number, uid) = read_track_entry(entry, report);
                if let Some(uid) = uid {
                    self.track_uids.insert(uid, number);
                }
            }
        }
    }

    /// Global tags go to the General track; per-track statistics (mkvmerge's BPS) give a track
    /// its bit rate.
    fn read_tags(&mut self, data: &[u8], report: &mut MediaReport) {
        let mut set = TagSet::default();
        for (id, tag) in children(data) {
            if id != 0x7373 {
                continue;
            }
            let mut track = None;
            let mut simple: Vec<(String, String)> = Vec::new();
            for (cid, value) in children(tag) {
                match cid {
                    0x63C0 => {
                        for (tid, tval) in children(value) {
                            if tid == 0x63C5 {
                                track = ebml_uint(tval)
                                    .and_then(|uid| self.track_uids.get(&uid).copied());
                            }
                        }
                    }
                    0x67C8 => {
                        let mut name = String::new();
                        let mut text = String::new();
                        for (sid, sval) in children(value) {
                            match sid {
                                0x45A3 => name = String::from_utf8_lossy(sval).into_owned(),
                                0x4487 => text = String::from_utf8_lossy(sval).into_owned(),
                                _ => {}
                            }
                        }
                        simple.push((name, text));
                    }
                    _ => {}
                }
            }
            match track {
                Some(number) => {
                    for (name, text) in &simple {
                        if name.eq_ignore_ascii_case("BPS") {
                            if let Ok(bps) = text.trim().parse::<u64>() {
                                set_track_bitrate(report, number, bps);
                            }
                        } else if name.eq_ignore_ascii_case("ENCODER") {
                            if let Some(a) =
                                report.audios.iter_mut().find(|a| a.stream_id == number)
                            {
                                a.encoded_library = Some(text.clone());
                            } else if let Some(v) =
                                report.videos.iter_mut().find(|v| v.stream_id == number)
                            {
                                v.encoded_library = Some(text.clone());
                            }
                        }
                    }
                }
                None => {
                    for (name, text) in &simple {
                        push_named(&mut set, name, text);
                    }
                }
            }
        }
        for (field, value) in set.0 {
            report.general.tags.insert(field, value);
        }
    }

    fn read_cluster(&mut self, data: &[u8], report: &mut MediaReport) {
        for (id, payload) in children(data) {
            match id {
                0xA3 | 0xA1 => self.read_block(payload, report),
                0xA0 => {
                    for (bid, block) in children(payload) {
                        if bid == 0xA1 {
                            self.read_block(block, report);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// A SimpleBlock / Block: TrackNumber (VINT), timecode (2), flags (1), frame data.
    fn read_block(&mut self, block: &[u8], report: &mut MediaReport) {
        let Ok((Some(track), vint_len)) = EbmlVint::read_element_size(block, 0) else {
            return;
        };
        let track = track as u32;
        let header_len = vint_len + 3;
        if block.len() <= header_len {
            return;
        }
        *self.track_bytes.entry(track).or_insert(0) += (block.len() - header_len) as u64;
        if self.probed.insert(track) {
            probe_audio_frame(block, vint_len, track, report);
        }
    }

    fn apply_track_sizes(&self, report: &mut MediaReport) {
        let seconds = report.general.duration_ms.unwrap_or(0.0) / 1000.0;
        for v in &mut report.videos {
            if let Some(&bytes) = self.track_bytes.get(&v.stream_id) {
                v.stream_size = Some(bytes);
                if seconds > 0.0 && v.bit_rate.is_none() {
                    v.bit_rate = Some((bytes as f64 * 8.0 / seconds) as u64);
                }
            }
        }
        for a in &mut report.audios {
            if let Some(&bytes) = self.track_bytes.get(&a.stream_id) {
                a.stream_size = Some(bytes);
                if seconds > 0.0 && a.bit_rate.is_none() {
                    a.bit_rate = Some((bytes as f64 * 8.0 / seconds) as u64);
                }
            }
        }
    }
}

fn set_track_bitrate(report: &mut MediaReport, number: u32, bps: u64) {
    if let Some(a) = report.audios.iter_mut().find(|a| a.stream_id == number) {
        a.bit_rate = Some(bps);
    } else if let Some(v) = report.videos.iter_mut().find(|v| v.stream_id == number) {
        v.bit_rate = Some(bps);
    }
}

/// AC-3 and DTS tracks carry no bit rate in their headers; the first frame has it.
fn probe_audio_frame(block: &[u8], vint_len: usize, track: u32, report: &mut MediaReport) {
    let Some(audio) = report.audios.iter_mut().find(|a| a.stream_id == track) else {
        return;
    };
    if audio.bit_rate.is_some()
        || !matches!(
            audio.format,
            AudioCodec::AC3 | AudioCodec::EAC3 | AudioCodec::DTS
        )
    {
        return;
    }
    // Skip any lacing header to reach the first frame.
    let flags = block[vint_len + 2];
    let mut start = vint_len + 3;
    match (flags >> 1) & 0x03 {
        1 => {
            // Xiph lacing
            let Some(&n) = block.get(start) else { return };
            start += 1;
            for _ in 0..n {
                while block.get(start) == Some(&255) {
                    start += 1;
                }
                start += 1;
            }
        }
        2 => {
            // EBML lacing
            start += 1;
            if let Ok((_, len)) = EbmlVint::read_element_size(block, start) {
                start += len;
            }
        }
        3 => start += 1, // fixed-size lacing
        _ => {}
    }
    let Some(frame) = block.get(start..) else {
        return;
    };

    if matches!(audio.format, AudioCodec::AC3 | AudioCodec::EAC3) {
        let Some(pos) = frame
            .windows(2)
            .position(|w| w == [0x0B, 0x77] || w == [0x77, 0x0B])
        else {
            return;
        };
        // A byte-swapped (little-endian) stream is swapped back before parsing.
        let bytes: Vec<u8> = if frame[pos] == 0x77 {
            frame[pos..]
                .as_chunks::<2>()
                .0
                .iter()
                .flat_map(|c| [c[1], c[0]])
                .collect()
        } else {
            frame[pos..].to_vec()
        };
        if let Ok(ac3) = Ac3Header::parse(&bytes) {
            audio.bit_rate = Some(ac3.bit_rate);
            audio.format = if ac3.is_eac3 {
                AudioCodec::EAC3
            } else {
                AudioCodec::AC3
            };
        }
    } else if let Some(pos) = frame.windows(4).position(|w| {
        w == [0x7F, 0xFE, 0x80, 0x01]
            || w == [0x1F, 0xFF, 0xE8, 0x00]
            || w == [0xFE, 0x7F, 0x01, 0x80]
    }) {
        if let Ok(dts) = DtsHeader::parse(&frame[pos..]) {
            audio.bit_rate = Some(dts.bit_rate);
            audio.format_profile = Some(dts.profile_name.to_string());
        }
    }
}

/// Reads one TrackEntry into a track. Returns its TrackNumber and TrackUID.
fn read_track_entry(data: &[u8], report: &mut MediaReport) -> (u32, Option<u64>) {
    let mut number = (report.videos.len() + report.audios.len() + report.texts.len() + 1) as u32;
    let mut uid = None;
    let mut track_type = 0u8;
    let mut codec_id = String::new();
    let mut codec_private: &[u8] = &[];
    let mut name = None;
    let mut language = None;
    let mut default = true;
    let mut forced = false;
    let mut default_duration_ns = 0u64;
    let mut video: &[u8] = &[];
    let mut audio: &[u8] = &[];

    for (id, value) in children(data) {
        match id {
            0xD7 => {
                if let Some(n) = ebml_uint(value).filter(|n| *n > 0) {
                    number = n as u32;
                }
            }
            0x73C5 => uid = ebml_uint(value),
            0x83 => track_type = value.first().copied().unwrap_or(0),
            0x86 => codec_id = String::from_utf8_lossy(value).trim().to_string(),
            0x63A2 => codec_private = value,
            0x536E => name = Some(String::from_utf8_lossy(value).into_owned()),
            0x22B59C => language = Some(String::from_utf8_lossy(value).into_owned()),
            0x88 => default = ebml_uint(value).unwrap_or(1) != 0,
            0x55AA => forced = ebml_uint(value).unwrap_or(0) != 0,
            0x23E383 => default_duration_ns = ebml_uint(value).unwrap_or(0),
            0xE0 => video = value,
            0xE1 => audio = value,
            _ => {}
        }
    }

    match track_type {
        1 => {
            let mut v = VideoTrack::default();
            v.stream_id = number;
            v.codec_id = Some(codec_id.clone());
            v.title = name;
            v.language = language;
            v.default = Some(default);
            v.forced = Some(forced);
            if default_duration_ns > 0 {
                v.frame_rate = Some(1_000_000_000.0 / default_duration_ns as f64);
            }
            read_video_settings(video, &mut v);
            apply_video_codec(&codec_id, codec_private, &mut v);
            report.videos.push(v);
        }
        2 => {
            let mut a = AudioTrack::default();
            a.stream_id = number;
            a.codec_id = Some(codec_id.clone());
            a.title = name;
            a.language = language;
            a.default = Some(default);
            a.forced = Some(forced);
            read_audio_settings(audio, &mut a);
            apply_audio_codec(&codec_id, codec_private, &mut a);
            report.audios.push(a);
        }
        17 => {
            let mut s = TextTrack::default();
            s.stream_id = number;
            s.codec_id = Some(codec_id.clone());
            s.title = name;
            s.language = language;
            s.default = Some(default);
            s.forced = Some(forced);
            s.format = match codec_id.as_str() {
                "S_TEXT/UTF8" => SubtitleCodec::SubRip,
                "S_TEXT/ASS" => SubtitleCodec::ASS,
                "S_TEXT/SSA" => SubtitleCodec::SSA,
                "S_HDMV/PGS" => SubtitleCodec::PGS,
                "S_TEXT/WEBVTT" => SubtitleCodec::WebVTT,
                "S_VOBSUB" => SubtitleCodec::VobSub,
                "S_DVBSUB" => SubtitleCodec::DVBSubtitle,
                other => SubtitleCodec::Other(other.to_string()),
            };
            report.texts.push(s);
        }
        _ => {}
    }
    (number, uid)
}

fn apply_video_codec(codec_id: &str, private: &[u8], v: &mut VideoTrack) {
    match codec_id {
        "V_MPEG4/ISO/AVC" => {
            v.format = VideoCodec::AVC;
            if private.len() >= 8 {
                let sps_len = u16::from_be_bytes([private[6], private[7]]) as usize;
                if let Some(sps) = private
                    .get(8..8 + sps_len)
                    .and_then(|s| AvcSps::parse(s).ok())
                {
                    v.width = sps.width;
                    v.height = sps.height;
                    v.format_profile = Some(sps.profile_name.to_string());
                    v.format_level = Some(sps.level_name);
                    v.bit_depth = sps.bit_depth;
                    v.chroma_subsampling = Some(sps.chroma_subsampling);
                    v.color_range = sps.color_range.or(v.color_range);
                    v.color_primaries = sps.color_primaries.or(v.color_primaries);
                    v.transfer_characteristics =
                        sps.transfer_characteristics.or(v.transfer_characteristics);
                    v.matrix_coefficients = sps.matrix_coefficients.or(v.matrix_coefficients);
                }
            }
        }
        "V_MPEGH/ISO/HEVC" => {
            v.format = VideoCodec::HEVC;
            apply_hvcc(private, v);
        }
        "V_MS/VFW/FOURCC" => {
            // CodecPrivate is a BITMAPINFOHEADER; the real codec is its biCompression.
            if private.len() >= 20 {
                let fourcc = [private[16], private[17], private[18], private[19]];
                v.format = vfw_codec(&fourcc);
                v.codec_id_info = Some(String::from_utf8_lossy(&fourcc).trim().to_string());
            }
        }
        "V_QUICKTIME" => {
            if private.len() >= 8 {
                let fourcc = [private[4], private[5], private[6], private[7]];
                v.format = vfw_codec(&fourcc);
                v.codec_id_info = Some(String::from_utf8_lossy(&fourcc).trim().to_string());
            }
        }
        "V_AV1" => v.format = VideoCodec::AV1,
        "V_VP9" => v.format = VideoCodec::VP9,
        "V_VP8" => v.format = VideoCodec::VP8,
        "V_MPEG2" => v.format = VideoCodec::MPEG2Video,
        "V_MPEG1" => v.format = VideoCodec::MPEG1Video,
        "V_THEORA" => v.format = VideoCodec::Theora,
        "V_PRORES" => v.format = VideoCodec::ProRes,
        "V_FFV1" => {
            v.format = VideoCodec::FFV1;
            v.compression_mode = Some("Lossless".to_string());
        }
        id if id.starts_with("V_MPEG4/ISO/") => v.format = VideoCodec::MPEG4Visual,
        other => v.format = VideoCodec::Other(other.to_string()),
    }
}

fn apply_audio_codec(codec_id: &str, private: &[u8], a: &mut AudioTrack) {
    match codec_id {
        "A_AAC" => {
            a.format = AudioCodec::AAC;
            if let Ok(aac) = AacInfo::parse_audio_specific_config(private) {
                a.sampling_rate = aac.sampling_rate;
                a.channels = aac.channels;
                a.channel_layout = Some(aac.channel_layout);
                a.format_profile = Some(aac.profile.to_string());
            }
        }
        "A_AC3" | "A_EAC3" => {
            a.format = if codec_id == "A_EAC3" {
                AudioCodec::EAC3
            } else {
                AudioCodec::AC3
            };
            if let Ok(ac3) = Ac3Header::parse(private) {
                a.bit_rate = Some(ac3.bit_rate);
            }
        }
        id if id.starts_with("A_DTS") => a.format = AudioCodec::DTS,
        "A_TRUEHD" | "A_MLP" => {
            a.format = AudioCodec::TrueHD;
            a.compression_mode = Some("Lossless".to_string());
        }
        "A_FLAC" => {
            a.format = AudioCodec::FLAC;
            a.compression_mode = Some("Lossless".to_string());
            if let Ok(flac) = FlacStreamInfo::parse(private) {
                a.sampling_rate = flac.sample_rate;
                a.channels = flac.channels;
                a.bit_depth = Some(flac.bit_depth);
            }
        }
        "A_OPUS" => {
            a.format = AudioCodec::Opus;
            if let Ok(opus) = OpusHead::parse(private) {
                a.channels = opus.channels;
                a.sampling_rate = opus.output_sample_rate;
            }
        }
        "A_VORBIS" => a.format = AudioCodec::Vorbis,
        "A_ALAC" => {
            a.format = AudioCodec::ALAC;
            a.compression_mode = Some("Lossless".to_string());
        }
        id if id.starts_with("A_MPEG/L3") => a.format = AudioCodec::MPEGAudioLayer3,
        id if id.starts_with("A_MPEG/L2") => a.format = AudioCodec::MPEGAudioLayer2,
        id if id.starts_with("A_MPEG/L1") => a.format = AudioCodec::MPEGAudioLayer1,
        id if id.starts_with("A_PCM") => {
            a.format = AudioCodec::PCM;
            a.compression_mode = Some("Lossless".to_string());
        }
        "A_AC4" => a.format = AudioCodec::AC4,
        id if id.starts_with("A_TTA") => a.format = AudioCodec::TTA,
        id if id.starts_with("A_WAVPACK") => a.format = AudioCodec::WavPack,
        other => a.format = AudioCodec::Other(other.to_string()),
    }
    a.bit_rate_mode = match a.format {
        AudioCodec::AC3 | AudioCodec::EAC3 | AudioCodec::DTS => Some(BitrateMode::Constant),
        AudioCodec::FLAC | AudioCodec::Vorbis => Some(BitrateMode::Variable),
        _ => None,
    };
    if a.channels > 0 {
        a.channel_layout = AudioChannelLayout::from_channel_count(a.channels);
    }
}

/// Walks an HEVCDecoderConfigurationRecord's NAL arrays to its SPS.
fn apply_hvcc(hvcc: &[u8], v: &mut VideoTrack) {
    if hvcc.len() < 23 {
        return;
    }
    let mut off = 23;
    for _ in 0..hvcc[22] {
        let Some(head) = hvcc.get(off..off + 3) else {
            return;
        };
        let nal_type = head[0] & 0x3F;
        let count = u16::from_be_bytes([head[1], head[2]]) as usize;
        off += 3;
        for _ in 0..count {
            let Some(len) = hvcc
                .get(off..off + 2)
                .map(|b| u16::from_be_bytes([b[0], b[1]]) as usize)
            else {
                return;
            };
            off += 2;
            if nal_type == 33 {
                if let Some(sps) = hvcc
                    .get(off..off + len)
                    .and_then(|n| HevcSps::parse(n).ok())
                {
                    if sps.width > 0 && sps.height > 0 {
                        v.width = sps.width;
                        v.height = sps.height;
                    }
                    v.format_profile = Some(sps.profile_name.to_string());
                    v.format_level = Some(sps.level_name);
                    v.format_tier = Some(sps.tier.to_string());
                    v.bit_depth = sps.bit_depth;
                    v.chroma_subsampling = Some(sps.chroma_subsampling);
                    v.color_range = sps.color_range.or(v.color_range);
                    v.color_primaries = sps.color_primaries.or(v.color_primaries);
                    v.transfer_characteristics =
                        sps.transfer_characteristics.or(v.transfer_characteristics);
                    v.matrix_coefficients = sps.matrix_coefficients.or(v.matrix_coefficients);
                    v.hdr_format = sps.hdr_format;
                }
            }
            off += len;
        }
    }
}

/// A VfW / QuickTime fourcc as a codec.
fn vfw_codec(fourcc: &[u8; 4]) -> VideoCodec {
    match &fourcc.map(|b| b.to_ascii_uppercase()) {
        b"H264" | b"X264" | b"AVC1" => VideoCodec::AVC,
        b"HEVC" | b"H265" | b"X265" | b"HVC1" => VideoCodec::HEVC,
        b"AV01" => VideoCodec::AV1,
        b"VP80" => VideoCodec::VP8,
        b"VP90" => VideoCodec::VP9,
        b"FFV1" => VideoCodec::FFV1,
        b"AVDN" | b"AVDH" => VideoCodec::DNxHD,
        b"CFHD" => VideoCodec::CineForm,
        b"APCO" | b"APCS" | b"APCN" | b"APCH" | b"AP4H" | b"AP4X" => VideoCodec::ProRes,
        b"DVSD" | b"DVC " | b"DVCP" | b"DV25" | b"DV50" => VideoCodec::DV,
        b"MPG2" | b"MPEG" | b"MP2V" => VideoCodec::MPEG2Video,
        b"XVID" | b"DIVX" | b"MP4V" | b"DX50" => VideoCodec::MPEG4Visual,
        b"WVC1" | b"WMV3" => VideoCodec::VC1,
        b"MJPG" => VideoCodec::Other("JPEG".to_string()),
        _ => VideoCodec::Other(String::from_utf8_lossy(fourcc).trim().to_string()),
    }
}

fn read_video_settings(data: &[u8], v: &mut VideoTrack) {
    let mut display = (None, None);
    for (id, value) in children(data) {
        match id {
            0xB0 => {
                if let Some(w) = ebml_uint(value) {
                    v.width = w as u32;
                    v.stored_width = Some(w as u32);
                }
            }
            0xBA => {
                if let Some(h) = ebml_uint(value) {
                    v.height = h as u32;
                    v.stored_height = Some(h as u32);
                }
            }
            0x54B0 => display.0 = ebml_uint(value),
            0x54BA => display.1 = ebml_uint(value),
            // FlagInterlaced: 1 interlaced, 2 progressive
            0x9A => match ebml_uint(value) {
                Some(1) => v.scan_type = Some("Interlaced".to_string()),
                Some(2) => v.scan_type = Some("Progressive".to_string()),
                _ => {}
            },
            0x9D => {
                v.scan_order = match ebml_uint(value) {
                    Some(1) | Some(9) => Some("TFF".to_string()),
                    Some(6) | Some(14) => Some("BFF".to_string()),
                    _ => None,
                }
            }
            0x55B0 => read_colour(value, v),
            _ => {}
        }
    }
    if let (Some(dw), Some(dh)) = display {
        if dw > 0 && dh > 0 {
            v.display_aspect_ratio = Some(dw as f64 / dh as f64);
            if v.width > 0 && v.height > 0 {
                v.sample_aspect_ratio =
                    Some((dw as f64 / dh as f64) / (v.width as f64 / v.height as f64));
            }
        }
    }
}

fn read_colour(data: &[u8], v: &mut VideoTrack) {
    for (id, value) in children(data) {
        let Some(n) = ebml_uint(value) else { continue };
        match id {
            0x55B1 => v.matrix_coefficients = Some(MatrixCoefficients::from_u8(n as u8)),
            0x55B2 if (8..=16).contains(&n) => v.bit_depth = n as u8,
            // Range: 0 unspecified, 1 broadcast (limited), 2 full, 3 defined by matrix.
            0x55B9 => {
                v.color_range = match n {
                    1 => Some(ColorRange::Limited),
                    2 => Some(ColorRange::Full),
                    _ => None,
                }
            }
            0x55BA => v.transfer_characteristics = Some(TransferCharacteristics::from_u8(n as u8)),
            0x55BB => v.color_primaries = Some(ColorPrimaries::from_u8(n as u8)),
            _ => {}
        }
    }
}

fn read_audio_settings(data: &[u8], a: &mut AudioTrack) {
    for (id, value) in children(data) {
        match id {
            0xB5 => {
                if let Some(rate) = ebml_float(value) {
                    a.sampling_rate = rate as u32;
                }
            }
            0x9F => a.channels = ebml_uint(value).unwrap_or(0) as u32,
            0x6264 => a.bit_depth = ebml_uint(value).map(|b| b as u8),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks_children_and_stops_at_truncation() {
        // DocType "webm", then an element claiming 0x10 bytes with only 2 present.
        let data = [
            0x42, 0x82, 0x84, b'w', b'e', b'b', b'm', 0x42, 0x87, 0x90, 1, 2,
        ];
        let items: Vec<_> = children(&data).collect();
        assert_eq!(items, vec![(0x4282, &b"webm"[..])]);
    }
}
