use vuio_media_info::{
    AudioCodec, ChromaSubsampling, ColorRange, ContainerFormat, MediaInfoError, Source, VideoCodec,
    inspect_bytes, inspect_source,
};

/// The value of `field` on the first track of `kind` in MediaInfo-style JSON.
fn field(json: &str, kind: &str, field: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).unwrap();
    v["media"]["track"]
        .as_array()?
        .iter()
        .find(|t| t["@type"] == kind)?
        .get(field)?
        .as_str()
        .map(str::to_string)
}

fn synchsafe(n: usize) -> [u8; 4] {
    let n = n as u32;
    [
        (n >> 21) as u8 & 0x7F,
        (n >> 14) as u8 & 0x7F,
        (n >> 7) as u8 & 0x7F,
        n as u8 & 0x7F,
    ]
}

/// An ID3v2.3 tag of ISO-8859-1 text frames.
fn id3v2(frames: &[(&str, &str)]) -> Vec<u8> {
    let mut body = Vec::new();
    for (id, text) in frames {
        body.extend_from_slice(id.as_bytes());
        body.extend_from_slice(&(text.len() as u32 + 1).to_be_bytes());
        body.extend_from_slice(&[0, 0, 0]);
        body.extend_from_slice(text.as_bytes());
    }
    let mut tag = b"ID3\x03\x00\x00".to_vec();
    tag.extend_from_slice(&synchsafe(body.len()));
    tag.extend_from_slice(&body);
    tag
}

/// `count` 128 kb/s MPEG-1 Layer III frames at 44.1 kHz (417 bytes each).
fn mp3_frames(count: usize) -> Vec<u8> {
    let mut out = Vec::new();
    for _ in 0..count {
        let mut f = vec![0u8; 417];
        f[..4].copy_from_slice(&[0xFF, 0xFB, 0x90, 0x00]);
        out.extend_from_slice(&f);
    }
    out
}

fn mp3_file() -> Vec<u8> {
    let mut file = id3v2(&[
        ("TIT2", "Big Dawgs"),
        ("TPE1", "Hanumankind"),
        ("TPE2", "Various"),
        ("TRCK", "03/12"),
        ("TCON", "(7)"),
        ("TYER", "2024"),
    ]);
    file.extend_from_slice(&mp3_frames(400));
    // ID3v1 at the end: its album fills the one field ID3v2 left empty.
    let mut v1 = vec![0u8; 128];
    v1[..3].copy_from_slice(b"TAG");
    v1[3..12].copy_from_slice(b"Ignored!!");
    v1[63..73].copy_from_slice(b"From ID3v1");
    v1[127] = 255;
    file.extend_from_slice(&v1);
    file
}

#[test]
fn mp3_tags_and_stream_come_out_in_mediainfo_fields() {
    let json = inspect_bytes(&mp3_file()).unwrap().to_json().unwrap();
    let g = |f| field(&json, "General", f);
    let a = |f| field(&json, "Audio", f);
    assert_eq!(g("Format").as_deref(), Some("MPEG Audio"));
    assert_eq!(g("Title").as_deref(), Some("Big Dawgs"));
    assert_eq!(g("Performer").as_deref(), Some("Hanumankind"));
    assert_eq!(g("Album_Performer").as_deref(), Some("Various"));
    assert_eq!(g("Track_Position").as_deref(), Some("03"));
    assert_eq!(g("Track_Position_Total").as_deref(), Some("12"));
    assert_eq!(g("Genre").as_deref(), Some("Hip-Hop"));
    assert_eq!(g("Recorded_Date").as_deref(), Some("2024"));
    assert_eq!(g("Album").as_deref(), Some("From ID3v1"));
    assert_eq!(a("SamplingRate").as_deref(), Some("44100"));
    assert_eq!(a("BitRate").as_deref(), Some("128000"));
    assert_eq!(a("BitRate_Mode").as_deref(), Some("CBR"));
    assert_eq!(a("Channels").as_deref(), Some("2"));
    assert_eq!(a("Format_Profile").as_deref(), Some("Layer 3"));
    // 400 frames x 1152 samples / 44100 Hz, measured from the audio between the tags.
    let secs: f64 = g("Duration").unwrap().parse().unwrap();
    assert!((secs - 400.0 * 1152.0 / 44100.0).abs() < 0.05, "{secs}");
}

/// Reading only the head and tail, and supplying ranges when asked, gives the same report as
/// reading the whole file.
#[test]
fn head_and_tail_reads_match_the_whole_file() {
    let file = mp3_file();
    let whole = inspect_bytes(&file).unwrap();

    let mut ranges: Vec<(u64, Vec<u8>)> = vec![
        (0, file[..4096].to_vec()),
        ((file.len() - 512) as u64, file[file.len() - 512..].to_vec()),
    ];
    let mut rounds = 0;
    let sparse = loop {
        let src = Source::sparse(
            file.len() as u64,
            ranges.iter().map(|(o, b)| (*o, &b[..])).collect(),
        );
        match inspect_source(&src) {
            Err(MediaInfoError::NeedMore { offset, len }) => {
                rounds += 1;
                assert!(rounds < 8);
                let end = (offset + len) as usize;
                ranges.push((offset, file[offset as usize..end].to_vec()));
            }
            other => break other.unwrap(),
        }
    };
    assert_eq!(sparse, whole);
}

#[test]
fn flac_vorbis_comments_and_vendor() {
    let mut file = b"fLaC".to_vec();
    // STREAMINFO: 44.1 kHz, stereo, 16-bit, 441000 samples.
    file.extend_from_slice(&[0x00, 0, 0, 34]);
    let mut info = [0u8; 34];
    info[0..2].copy_from_slice(&4096u16.to_be_bytes());
    info[2..4].copy_from_slice(&4096u16.to_be_bytes());
    let packed: u64 = (44100u64 << 44) | (1 << 41) | (15 << 36) | 441000;
    info[10..18].copy_from_slice(&packed.to_be_bytes());
    file.extend_from_slice(&info);
    // VORBIS_COMMENT, last block.
    let mut vc = Vec::new();
    let vendor = b"reference libFLAC 1.4.3";
    vc.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
    vc.extend_from_slice(vendor);
    let comments = [
        "TITLE=Oceans",
        "ALBUMARTIST=JAY-Z",
        "TRACKNUMBER=5",
        "DISCNUMBER=1",
        "DISCTOTAL=2",
        "REPLAYGAIN_TRACK_GAIN=-6.54 dB",
    ];
    vc.extend_from_slice(&(comments.len() as u32).to_le_bytes());
    for c in comments {
        vc.extend_from_slice(&(c.len() as u32).to_le_bytes());
        vc.extend_from_slice(c.as_bytes());
    }
    file.push(0x84);
    file.extend_from_slice(&(vc.len() as u32).to_be_bytes()[1..]);
    file.extend_from_slice(&vc);
    file.extend_from_slice(&[0xFF, 0xF8, 0, 0]); // the start of the frames

    let json = inspect_bytes(&file).unwrap().to_json().unwrap();
    let g = |f| field(&json, "General", f);
    assert_eq!(g("Format").as_deref(), Some("FLAC"));
    assert_eq!(g("Title").as_deref(), Some("Oceans"));
    assert_eq!(g("Album_Performer").as_deref(), Some("JAY-Z"));
    assert_eq!(g("Track_Position").as_deref(), Some("5"));
    assert_eq!(g("Part_Position").as_deref(), Some("1"));
    assert_eq!(g("Part_Position_Total").as_deref(), Some("2"));
    assert_eq!(g("ReplayGain_Gain").as_deref(), Some("-6.54"));
    assert_eq!(
        field(&json, "Audio", "Encoded_Library").as_deref(),
        Some("reference libFLAC 1.4.3")
    );
    assert_eq!(
        field(&json, "Audio", "BitRate_Mode").as_deref(),
        Some("VBR")
    );
    assert_eq!(
        field(&json, "Audio", "SamplingRate").as_deref(),
        Some("44100")
    );
}

#[test]
fn wav_from_disk() {
    let path = std::env::temp_dir().join("vuio_json_output_test.wav");
    let mut f = b"RIFF".to_vec();
    f.extend_from_slice(&(36u32 + 88200).to_le_bytes());
    f.extend_from_slice(b"WAVEfmt ");
    f.extend_from_slice(&16u32.to_le_bytes());
    f.extend_from_slice(&1u16.to_le_bytes()); // PCM
    f.extend_from_slice(&2u16.to_le_bytes());
    f.extend_from_slice(&44100u32.to_le_bytes());
    f.extend_from_slice(&(44100u32 * 4).to_le_bytes());
    f.extend_from_slice(&4u16.to_le_bytes());
    f.extend_from_slice(&16u16.to_le_bytes());
    f.extend_from_slice(b"data");
    f.extend_from_slice(&88200u32.to_le_bytes()); // 0.5 s
    f.extend_from_slice(&vec![0u8; 88200]);
    std::fs::write(&path, &f).unwrap();

    let report = inspect_bytes(&std::fs::read(&path).unwrap()).unwrap();
    let _ = std::fs::remove_file(&path);
    assert_eq!(report.general.format, ContainerFormat::WAV);
    let json = report.to_json().unwrap();
    assert_eq!(field(&json, "General", "Format").as_deref(), Some("Wave"));
    assert_eq!(
        field(&json, "General", "Duration").as_deref(),
        Some("0.500")
    );
    assert_eq!(field(&json, "Audio", "Format").as_deref(), Some("PCM"));
    assert_eq!(field(&json, "Audio", "BitRate").as_deref(), Some("1411200"));
    assert_eq!(
        field(&json, "Audio", "BitRate_Mode").as_deref(),
        Some("CBR")
    );
    assert_eq!(field(&json, "Audio", "BitDepth").as_deref(), Some("16"));
}

/// A minimal Matroska file: EBML header + Segment > Tracks > one TrackEntry.
fn mkv(track_entry: &[u8], after_tracks: &[u8]) -> Vec<u8> {
    let mut tracks = vec![0xAE, 0x80 | track_entry.len() as u8];
    tracks.extend_from_slice(track_entry);
    let mut segment = vec![0x16, 0x54, 0xAE, 0x6B, 0x80 | tracks.len() as u8];
    segment.extend_from_slice(&tracks);
    segment.extend_from_slice(after_tracks);
    let mut file = vec![0x1A, 0x45, 0xDF, 0xA3, 0x84, 0x42, 0x86, 0x81, 0x01];
    file.extend_from_slice(&[0x18, 0x53, 0x80, 0x67, 0x80 | segment.len() as u8]);
    file.extend_from_slice(&segment);
    file
}

fn video_entry(video: &[u8]) -> Vec<u8> {
    let mut entry = vec![
        0xD7, 0x81, 0x01, 0x83, 0x81, 0x01, 0x86, 0x85, b'V', b'_', b'V', b'P', b'8',
    ];
    entry.push(0xE0);
    entry.push(0x80 | video.len() as u8);
    entry.extend_from_slice(video);
    entry
}

/// EBML stores integers in the fewest bytes that fit, so a 240-pixel height is one byte.
#[test]
fn matroska_reads_narrow_ebml_integers() {
    let file = mkv(
        &video_entry(&[0xB0, 0x82, 0x01, 0x40, 0xBA, 0x81, 0xF0]),
        &[],
    );
    let report = inspect_bytes(&file).unwrap();
    assert_eq!(report.videos.len(), 1);
    assert_eq!(report.videos[0].format, VideoCodec::VP8);
    assert_eq!(
        (report.videos[0].width, report.videos[0].height),
        (320, 240)
    );
}

/// Matroska's Range element: 1 is broadcast (limited), 2 is full.
#[test]
fn matroska_colour_range_mapping() {
    for (range, expected) in [(1u8, ColorRange::Limited), (2, ColorRange::Full)] {
        let colour = [0x55u8, 0xB9, 0x81, range];
        let mut video = vec![
            0xB0,
            0x82,
            0x01,
            0x40,
            0xBA,
            0x81,
            0xF0,
            0x55,
            0xB0,
            0x80 | colour.len() as u8,
        ];
        video.extend_from_slice(&colour);
        let report = inspect_bytes(&mkv(&video_entry(&video), &[])).unwrap();
        assert_eq!(
            report.videos[0].color_range,
            Some(expected),
            "Range {range}"
        );
    }
}

/// An AAC block containing the bytes 0B 77 must not be mistaken for AC-3.
#[test]
fn matroska_aac_is_not_reclassified_by_block_bytes() {
    let mut entry = vec![
        0xD7, 0x81, 0x01, 0x83, 0x81, 0x02, 0x86, 0x85, b'A', b'_', b'A', b'A', b'C',
    ];
    entry.extend_from_slice(&[0x63, 0xA2, 0x82, 0x11, 0x88]); // AAC-LC, 48 kHz, mono
    entry.extend_from_slice(&[
        0xE1, 0x89, 0xB5, 0x84, 0x47, 0x3B, 0x80, 0x00, 0x9F, 0x81, 0x01,
    ]);
    let block = [0x81, 0x00, 0x00, 0x00, 0x0B, 0x77, 0, 0, 0, 0, 0, 0];
    let mut cluster = vec![0xE7, 0x81, 0x00, 0xA3, 0x80 | block.len() as u8];
    cluster.extend_from_slice(&block);
    let mut after = vec![0x1F, 0x43, 0xB6, 0x75, 0x80 | cluster.len() as u8];
    after.extend_from_slice(&cluster);

    let report = inspect_bytes(&mkv(&entry, &after)).unwrap();
    let a = &report.audios[0];
    assert_eq!(a.format, AudioCodec::AAC);
    assert_eq!((a.channels, a.sampling_rate), (1, 48000));
}

#[test]
fn ogg_theora_dimensions() {
    let mut theora = vec![
        0x80, b't', b'h', b'e', b'o', b'r', b'a', 3, 2, 1, 0, 0x14, 0, 0x0F,
    ];
    theora.extend_from_slice(&[0, 0x01, 0x40, 0, 0, 0xF0, 0, 0]); // PICW 320, PICH 240, offsets
    theora.extend_from_slice(&[0, 0, 0, 25, 0, 0, 0, 1]); // 25/1 fps
    theora.extend_from_slice(&[0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]); // PAR 1:1, CS, NOMBR, QUAL, PF 4:2:0
    let mut page = b"OggS\x00\x02".to_vec();
    page.extend_from_slice(&[0u8; 20]);
    page.push(1);
    page.push(theora.len() as u8);
    page.extend_from_slice(&theora);

    let report = inspect_bytes(&page).unwrap();
    assert_eq!(report.general.format, ContainerFormat::Ogg);
    let v = &report.videos[0];
    assert_eq!(v.format, VideoCodec::Theora);
    assert_eq!((v.width, v.height), (320, 240));
    assert_eq!(v.frame_rate, Some(25.0));
    assert_eq!(v.chroma_subsampling, Some(ChromaSubsampling::YUV420));
}

#[test]
fn unknown_input_is_an_error() {
    assert!(matches!(
        inspect_bytes(b"not media at all"),
        Err(MediaInfoError::UnsupportedFormat(_))
    ));
}
