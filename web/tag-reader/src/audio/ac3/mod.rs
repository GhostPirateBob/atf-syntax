use crate::core::{
    bitstream::MsbBitReader,
    error::{MediaInfoError, Result},
    types::*,
};

pub const AC3_SAMPLE_RATES: [u32; 4] = [48000, 44100, 32000, 0];
pub const AC3_BITRATES_KBPS: [u32; 38] = [
    32, 32, 40, 40, 48, 48, 56, 56, 64, 64, 80, 80, 96, 96, 112, 112, 128, 128, 160, 160, 192, 192,
    224, 224, 256, 256, 320, 320, 384, 384, 448, 448, 512, 512, 576, 576, 640, 640,
];

/// Parsed Dolby Digital (AC-3) or Dolby Digital Plus (E-AC-3) frame header.
#[derive(Debug, Clone, PartialEq)]
pub struct Ac3Header {
    pub is_eac3: bool,
    pub sample_rate: u32,
    pub bit_rate: u64,
    pub channels: u32,
    pub channel_layout: AudioChannelLayout,
    pub has_lfe: bool,
    pub frame_size: usize,
}

impl Ac3Header {
    pub fn parse(data: &[u8]) -> Result<Self> {
        if data.len() < 8 {
            return Err(MediaInfoError::UnexpectedEof {
                expected: 8,
                actual: data.len(),
            });
        }

        let syncword = u16::from_be_bytes([data[0], data[1]]);
        if syncword != 0x0B77 {
            return Err(MediaInfoError::InvalidSyncword {
                expected: 0x0B77,
                actual: syncword as u32,
            });
        }

        let mut r = MsbBitReader::new(&data[2..]);

        let is_eac3;
        let sample_rate;
        let mut bit_rate = 384000;

        let has_lfe;
        let mut frame_size = 1536;

        let _crc1 = r.read_bits(16)?;
        let fscod = r.read_bits(2)? as usize;
        let frmsizecod = r.read_bits(6)? as usize;
        let bsid = r.read_bits(5)? as u8;

        let (channels, channel_layout) = if bsid <= 8 {
            is_eac3 = false;
            sample_rate = AC3_SAMPLE_RATES[fscod];
            if frmsizecod < AC3_BITRATES_KBPS.len() {
                bit_rate = AC3_BITRATES_KBPS[frmsizecod] as u64 * 1000;
            }

            let _bsmod = r.read_bits(3)?;
            let acmod = r.read_bits(3)? as u8;

            if (acmod & 0x01) != 0 && acmod != 1 {
                let _cmixlev = r.read_bits(2)?;
            }
            if (acmod & 0x04) != 0 {
                let _surmixlev = r.read_bits(2)?;
            }
            if acmod == 2 {
                let _dsurmod = r.read_bits(2)?;
            }

            has_lfe = r.read_bit()?;

            let (base_channels, layout) = Self::acmod_to_layout(acmod, has_lfe);
            (base_channels, layout)
        } else {
            is_eac3 = true;
            let mut r2 = MsbBitReader::new(&data[2..]);
            let _strmtyp = r2.read_bits(2)?;
            let _substreamid = r2.read_bits(3)?;
            let frmsiz = r2.read_bits(11)? as usize;
            frame_size = (frmsiz + 1) * 2;

            // fscod == 3 selects the half-rate table and implies six blocks per frame.
            let fscod_eac3 = r2.read_bits(2)? as usize;
            let num_blocks;
            if fscod_eac3 == 3 {
                let fscod2 = r2.read_bits(2)? as usize;
                sample_rate = match fscod2 {
                    0 => 24000,
                    1 => 22050,
                    _ => 16000,
                };
                num_blocks = 6;
            } else {
                let numblkscod = r2.read_bits(2)? as usize;
                sample_rate = AC3_SAMPLE_RATES[fscod_eac3];
                num_blocks = [1usize, 2, 3, 6][numblkscod];
            }

            // Each block carries 256 samples, so the frame duration fixes the bit rate.
            let samples_per_frame = num_blocks * 256;
            if samples_per_frame > 0 && sample_rate > 0 {
                bit_rate = (frame_size as u64 * 8 * sample_rate as u64) / samples_per_frame as u64;
            }

            let acmod = r2.read_bits(3)? as u8;
            has_lfe = r2.read_bit()?;

            let (base_channels, layout) = Self::acmod_to_layout(acmod, has_lfe);
            (base_channels, layout)
        };

        Ok(Self {
            is_eac3,
            sample_rate,
            bit_rate,
            channels,
            channel_layout,
            has_lfe,
            frame_size,
        })
    }

    fn acmod_to_layout(acmod: u8, has_lfe: bool) -> (u32, AudioChannelLayout) {
        let (chans, layout) = match acmod {
            0 => (2, AudioChannelLayout::Stereo),
            1 => (1, AudioChannelLayout::Mono),
            2 => (2, AudioChannelLayout::Stereo),
            3 => (3, AudioChannelLayout::Surround3_0),
            4 => (3, AudioChannelLayout::Surround3_0),
            5 => (4, AudioChannelLayout::Surround4_0),
            6 => (4, AudioChannelLayout::Surround4_0),
            7 => (5, AudioChannelLayout::Surround5_1),
            _ => (2, AudioChannelLayout::Stereo),
        };

        if has_lfe {
            (chans + 1, layout)
        } else {
            (chans, layout)
        }
    }
}
