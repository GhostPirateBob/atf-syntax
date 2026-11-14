use crate::core::types::ContainerFormat;

/// Identifies the container from the start of the file (the first 4 KB is plenty).
pub struct FormatDetector;

impl FormatDetector {
    pub fn detect(header: &[u8]) -> ContainerFormat {
        if header.len() < 3 {
            return ContainerFormat::Unknown;
        }
        let prefix = &header[..header.len().min(4096)];

        // Matroska / WebM EBML header
        if prefix.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
            if prefix.windows(4).any(|w| w == b"webm") {
                return ContainerFormat::WebM;
            }
            return ContainerFormat::Matroska;
        }

        // ISOBMFF / MP4 / QuickTime: [size:4] then ftyp / moov / mdat / wide / skip
        if prefix.len() >= 8 {
            match &prefix[4..8] {
                b"ftyp" => {
                    if prefix.len() >= 12 && matches!(&prefix[8..12], b"qt  " | b"moov") {
                        return ContainerFormat::QuickTime;
                    }
                    return ContainerFormat::MPEG4;
                }
                b"moov" | b"mdat" | b"wide" | b"skip" => return ContainerFormat::MPEG4,
                _ => {}
            }
        }

        // RIFF (AVI / WAV), RF64 / BW64
        if prefix.starts_with(b"RIFF") || prefix.starts_with(b"RF64") || prefix.starts_with(b"BW64")
        {
            if prefix.len() >= 12 && matches!(&prefix[8..12], b"AVI " | b"AVIX") {
                return ContainerFormat::AVI;
            }
            return ContainerFormat::WAV;
        }

        // MPEG-TS: 0x47 every 188 bytes; M2TS / Blu-ray has a 4-byte timestamp before each.
        if prefix[0] == 0x47
            && (prefix.len() < 188 * 3 || (prefix[188] == 0x47 && prefix[376] == 0x47))
        {
            return ContainerFormat::MPEGTS;
        }
        if prefix.len() >= 192 * 3
            && prefix[4] == 0x47
            && prefix[196] == 0x47
            && prefix[388] == 0x47
        {
            return ContainerFormat::MPEGTS;
        }

        // MPEG-PS pack header
        if prefix.starts_with(&[0x00, 0x00, 0x01, 0xBA]) {
            return ContainerFormat::MPEGPS;
        }
        if prefix.starts_with(b"OggS") {
            return ContainerFormat::Ogg;
        }
        if prefix.starts_with(b"fLaC") {
            return ContainerFormat::FLAC;
        }
        if prefix.starts_with(b"ID3") {
            return ContainerFormat::MP3;
        }
        // ADTS AAC: 12-bit sync, layer 00
        if prefix[0] == 0xFF && (prefix[1] & 0xF6) == 0xF0 {
            return ContainerFormat::AAC;
        }
        // MPEG-1/2 audio frame sync
        if prefix[0] == 0xFF && (prefix[1] & 0xE0) == 0xE0 {
            return ContainerFormat::MP3;
        }
        if prefix.starts_with(b"MP+") || prefix.starts_with(b"MPCK") {
            return ContainerFormat::MPC;
        }
        // ASF header object GUID
        if prefix.starts_with(&[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11]) {
            return ContainerFormat::ASF;
        }
        if prefix.starts_with(b"DSD ") {
            return ContainerFormat::DSF;
        }
        if prefix.starts_with(b"FRM8") && prefix.len() >= 16 && &prefix[12..16] == b"DSD " {
            return ContainerFormat::DSDIFF;
        }
        if prefix.starts_with(b"FORM")
            && prefix.len() >= 12
            && matches!(&prefix[8..12], b"AIFF" | b"AIFC")
        {
            return ContainerFormat::AIFF;
        }
        if prefix.starts_with(b"MAC ") {
            return ContainerFormat::APE;
        }
        if prefix.starts_with(b"wvpk") {
            return ContainerFormat::WavPack;
        }
        ContainerFormat::Unknown
    }
}
