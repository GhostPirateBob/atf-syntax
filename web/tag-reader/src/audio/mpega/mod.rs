use crate::core::{
    error::{MediaInfoError, Result},
    types::*,
};

pub const MP3_BITRATES_V1_L1: [u32; 16] = [
    0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0,
];
pub const MP3_BITRATES_V1_L2: [u32; 16] = [
    0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0,
];
pub const MP3_BITRATES_V1_L3: [u32; 16] = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
pub const MP3_BITRATES_V2_L1: [u32; 16] = [
    0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0,
];
pub const MP3_BITRATES_V2_L23: [u32; 16] = [
    0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
];

pub const MP3_SAMPLE_RATES_V1: [u32; 4] = [44100, 48000, 32000, 0];
pub const MP3_SAMPLE_RATES_V2: [u32; 4] = [22050, 24000, 16000, 0];
pub const MP3_SAMPLE_RATES_V2_5: [u32; 4] = [11025, 12000, 8000, 0];

/// An MPEG audio frame header, plus the Xing / Info / VBRI header the first frame may carry.
#[derive(Debug, Clone, PartialEq)]
pub struct MpegaHeader {
    pub version: &'static str,
    pub layer: &'static str,
    pub sample_rate: u32,
    pub bit_rate: u64,
    pub channels: u32,
    pub channel_layout: AudioChannelLayout,
    pub samples_per_frame: u32,
    pub frame_size: usize,
    /// A Xing or VBRI header (variable bit rate); an Info header is the CBR flavour of Xing.
    pub is_vbr: bool,
    pub xing_frames: Option<u32>,
    pub xing_bytes: Option<u32>,
    /// The 9-byte encoder string after a Xing / Info header (`LAME3.100`, `Lavc61.19`).
    pub encoder: Option<String>,
}

/// Whether `b` starts with a plausible frame header: sync, a defined version, layer, bit rate
/// and sample rate. A bare sync word turns up by chance inside other data far too often.
pub fn is_frame_header(b: &[u8]) -> bool {
    b.len() >= 4
        && b[0] == 0xFF
        && b[1] & 0xE0 == 0xE0
        && (b[1] >> 3) & 0x03 != 1 // reserved version
        && (b[1] >> 1) & 0x03 != 0 // reserved layer
        && (b[2] >> 4) != 0x0F // bad bit rate
        && (b[2] >> 2) & 0x03 != 3 // reserved sample rate
}

impl MpegaHeader {
    pub fn parse(data: &[u8]) -> Result<Self> {
        if data.len() < 4 {
            return Err(MediaInfoError::UnexpectedEof {
                expected: 4,
                actual: data.len(),
            });
        }
        if data[0] != 0xFF || data[1] & 0xE0 != 0xE0 {
            return Err(MediaInfoError::InvalidSyncword {
                expected: 0x7FF,
                actual: ((data[0] as u32) << 3) | (data[1] as u32 >> 5),
            });
        }

        let version_id = (data[1] >> 3) & 0x03; // 0: MPEG 2.5, 2: MPEG 2, 3: MPEG 1
        let layer_id = (data[1] >> 1) & 0x03; // 1: Layer III, 2: Layer II, 3: Layer I
        let bitrate_idx = (data[2] >> 4) as usize;
        let sampling_idx = ((data[2] >> 2) & 0x03) as usize;
        let padding = (data[2] >> 1) & 0x01;
        let channel_mode = data[3] >> 6;
        let mpeg1 = version_id == 3;

        let version = match version_id {
            0 => "Version 2.5",
            2 => "Version 2",
            _ => "Version 1",
        };
        let layer = match layer_id {
            2 => "Layer 2",
            3 => "Layer 1",
            _ => "Layer 3",
        };
        let sample_rate = match version_id {
            0 => MP3_SAMPLE_RATES_V2_5[sampling_idx],
            2 => MP3_SAMPLE_RATES_V2[sampling_idx],
            _ => MP3_SAMPLE_RATES_V1[sampling_idx],
        };
        let kbps = match (mpeg1, layer_id) {
            (true, 3) => MP3_BITRATES_V1_L1[bitrate_idx],
            (true, 2) => MP3_BITRATES_V1_L2[bitrate_idx],
            (true, _) => MP3_BITRATES_V1_L3[bitrate_idx],
            (false, 3) => MP3_BITRATES_V2_L1[bitrate_idx],
            (false, _) => MP3_BITRATES_V2_L23[bitrate_idx],
        };
        let bit_rate = kbps as u64 * 1000;
        let (channels, channel_layout) = match channel_mode {
            3 => (1, AudioChannelLayout::Mono),
            _ => (2, AudioChannelLayout::Stereo),
        };
        // Layer I: 384; Layer II: 1152; Layer III: 1152 for MPEG-1, 576 for MPEG-2 / 2.5.
        let samples_per_frame: u32 = match layer_id {
            3 => 384,
            2 => 1152,
            _ if mpeg1 => 1152,
            _ => 576,
        };
        let frame_size = if sample_rate > 0 && bit_rate > 0 {
            if layer_id == 3 {
                ((12 * bit_rate / sample_rate as u64 + padding as u64) * 4) as usize
            } else {
                (samples_per_frame as u64 / 8 * bit_rate / sample_rate as u64 + padding as u64)
                    as usize
            }
        } else {
            0 // free format
        };

        let mut header = Self {
            version,
            layer,
            sample_rate,
            bit_rate,
            channels,
            channel_layout,
            samples_per_frame,
            frame_size,
            is_vbr: false,
            xing_frames: None,
            xing_bytes: None,
            encoder: None,
        };
        header.read_vbr_header(data, mpeg1);
        Ok(header)
    }

    /// Xing / Info sit after the side information (its size depends on version and channels);
    /// VBRI always 32 bytes after the frame header.
    fn read_vbr_header(&mut self, data: &[u8], mpeg1: bool) {
        let be = |i: usize| {
            data.get(i..i + 4)
                .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
        };
        let side_info = match (mpeg1, self.channels) {
            (true, 1) => 17,
            (true, _) => 32,
            (false, 1) => 9,
            (false, _) => 17,
        };
        let xing = 4 + side_info;
        match data.get(xing..xing + 4) {
            Some(b"Xing") | Some(b"Info") => {
                self.is_vbr = &data[xing..xing + 4] == b"Xing";
                let flags = be(xing + 4).unwrap_or(0);
                let mut pos = xing + 8;
                if flags & 0x01 != 0 {
                    self.xing_frames = be(pos);
                    pos += 4;
                }
                if flags & 0x02 != 0 {
                    self.xing_bytes = be(pos);
                    pos += 4;
                }
                if flags & 0x04 != 0 {
                    pos += 100; // seek table
                }
                if flags & 0x08 != 0 {
                    pos += 4; // quality
                }
                self.encoder = data
                    .get(pos..pos + 9)
                    .map(|b| {
                        String::from_utf8_lossy(b)
                            .trim_end_matches(['\0', ' '])
                            .to_string()
                    })
                    .filter(|s| {
                        s.len() >= 4 && s.bytes().all(|c| c.is_ascii_graphic() || c == b' ')
                    });
            }
            _ => {
                if data.get(36..40) == Some(b"VBRI") {
                    self.is_vbr = true;
                    self.xing_bytes = be(46);
                    self.xing_frames = be(50);
                }
            }
        }
    }
}
