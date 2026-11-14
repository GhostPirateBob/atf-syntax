//! MediaInfo's JSON schema: `{"media": {"@ref": ..., "track": [{"@type": "General", ...}, ...]}}`
//! with every value a string, as `mediainfo --Output=JSON` writes it. Fields with nothing to say
//! are left out rather than written as zero.

use crate::core::models::MediaReport;
use serde_json::{Map, Value};

struct Track(Map<String, Value>);

impl Track {
    fn new(kind: &str) -> Self {
        let mut map = Map::new();
        map.insert("@type".into(), Value::String(kind.into()));
        Self(map)
    }

    fn put(&mut self, key: &str, value: Option<impl ToString>) {
        if let Some(v) = value {
            let v = v.to_string();
            if !v.is_empty() {
                self.0.insert(key.into(), Value::String(v));
            }
        }
    }

    fn flag(&mut self, key: &str, value: Option<bool>) {
        self.put(key, value.map(|b| if b { "Yes" } else { "No" }));
    }
}

/// Seconds with millisecond precision, as MediaInfo writes durations.
fn seconds(ms: f64) -> String {
    format!("{:.3}", ms / 1000.0)
}

fn nonzero<T: PartialEq + Default + ToString>(v: T) -> Option<String> {
    (v != T::default()).then(|| v.to_string())
}

pub(crate) fn to_value(report: &MediaReport) -> Value {
    let mut tracks = Vec::new();

    let g = &report.general;
    let mut t = Track::new("General");
    t.put("CompleteName", g.file_name.as_deref());
    t.put("Format", Some(g.format.display_name()));
    t.put("Format_Profile", g.format_profile.as_deref());
    t.put("Format_Version", g.format_version.as_deref());
    t.put("CodecID", g.codec_id.as_deref());
    t.put("FileSize", Some(g.file_size));
    t.put("Duration", g.duration_ms.filter(|d| *d > 0.0).map(seconds));
    t.put(
        "OverallBitRate_Mode",
        g.overall_bitrate_mode.map(|m| m.code()),
    );
    t.put("OverallBitRate", g.overall_bitrate.filter(|b| *b > 0));
    for (field, value) in &g.tags {
        t.put(field, Some(value));
    }
    tracks.push(Value::Object(t.0));

    for v in &report.videos {
        let mut t = Track::new("Video");
        t.put("ID", nonzero(v.stream_id));
        t.put("Format", Some(v.format.display_name()));
        t.put("Format_Info", v.format_info.as_deref());
        t.put("Format_Profile", v.format_profile.as_deref());
        t.put("Format_Level", v.format_level.as_deref());
        t.put("Format_Tier", v.format_tier.as_deref());
        t.put("Format_Version", v.format_version.as_deref());
        t.put("CodecID", v.codec_id.as_deref());
        t.put("CodecID_Info", v.codec_id_info.as_deref());
        t.put("Duration", v.duration_ms.filter(|d| *d > 0.0).map(seconds));
        t.put("BitRate", v.bit_rate.filter(|b| *b > 0));
        t.put("Width", nonzero(v.width));
        t.put("Height", nonzero(v.height));
        t.put("Stored_Width", v.stored_width);
        t.put("Stored_Height", v.stored_height);
        t.put(
            "PixelAspectRatio",
            v.sample_aspect_ratio.map(|r| format!("{r:.3}")),
        );
        t.put(
            "DisplayAspectRatio",
            v.display_aspect_ratio.map(|r| format!("{r:.3}")),
        );
        t.put("FrameRate_Mode", v.frame_rate_mode.map(|m| m.code()));
        t.put("FrameRate", v.frame_rate.map(|f| format!("{f:.3}")));
        t.put("FrameCount", v.frame_count);
        t.put("ColorSpace", v.color_space.as_deref());
        t.put(
            "ChromaSubsampling",
            v.chroma_subsampling.map(|c| c.display_name()),
        );
        t.put("BitDepth", nonzero(v.bit_depth));
        t.put("ScanType", v.scan_type.as_deref());
        t.put("ScanOrder", v.scan_order.as_deref());
        t.put("Compression_Mode", v.compression_mode.as_deref());
        t.put("StreamSize", v.stream_size);
        t.put("Encoded_Library", v.encoded_library.as_deref());
        t.put("colour_range", v.color_range.map(|r| r.display_name()));
        // An "Unspecified" colour tag carries no information, so it is left out.
        let specified = |name: &'static str| (name != "Unspecified").then_some(name);
        t.put(
            "colour_primaries",
            v.color_primaries.and_then(|c| specified(c.display_name())),
        );
        t.put(
            "transfer_characteristics",
            v.transfer_characteristics
                .and_then(|c| specified(c.display_name())),
        );
        t.put(
            "matrix_coefficients",
            v.matrix_coefficients
                .and_then(|c| specified(c.display_name())),
        );
        t.put("HDR_Format", v.hdr_format.as_deref());
        t.put("Title", v.title.as_deref());
        t.put("Language", v.language.as_deref());
        t.flag("Default", v.default);
        t.flag("Forced", v.forced);
        tracks.push(Value::Object(t.0));
    }

    for a in &report.audios {
        let mut t = Track::new("Audio");
        t.put("ID", nonzero(a.stream_id));
        t.put("Format", Some(a.format.display_name()));
        t.put("Format_Info", a.format_info.as_deref());
        t.put(
            "Format_Profile",
            a.format_profile.as_deref().or(a.format.format_profile()),
        );
        t.put("CodecID", a.codec_id.as_deref());
        t.put("Duration", a.duration_ms.filter(|d| *d > 0.0).map(seconds));
        t.put("BitRate_Mode", a.bit_rate_mode.map(|m| m.code()));
        t.put("BitRate", a.bit_rate.filter(|b| *b > 0));
        t.put("Channels", nonzero(a.channels));
        t.put("SamplingRate", nonzero(a.sampling_rate));
        t.put("FrameCount", a.frame_count);
        t.put("BitDepth", a.bit_depth.filter(|d| *d > 0));
        t.put("Compression_Mode", a.compression_mode.as_deref());
        t.put("StreamSize", a.stream_size);
        t.put("Encoded_Library", a.encoded_library.as_deref());
        t.put("Title", a.title.as_deref());
        t.put("Language", a.language.as_deref());
        t.flag("Default", a.default);
        t.flag("Forced", a.forced);
        tracks.push(Value::Object(t.0));
    }

    for s in &report.texts {
        let mut t = Track::new("Text");
        t.put("ID", nonzero(s.stream_id));
        t.put("Format", Some(s.format.display_name()));
        t.put("Format_Info", s.format_info.as_deref());
        t.put("CodecID", s.codec_id.as_deref());
        t.put("Duration", s.duration_ms.filter(|d| *d > 0.0).map(seconds));
        t.put("Title", s.title.as_deref());
        t.put("Language", s.language.as_deref());
        t.flag("Default", s.default);
        t.flag("Forced", s.forced);
        tracks.push(Value::Object(t.0));
    }

    let mut media = Map::new();
    if let Some(name) = &g.file_name {
        media.insert("@ref".into(), Value::String(name.clone()));
    }
    media.insert("track".into(), Value::Array(tracks));
    let mut root = Map::new();
    root.insert("media".into(), Value::Object(media));
    Value::Object(root)
}
