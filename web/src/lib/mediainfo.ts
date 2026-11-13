// MediaInfo JSON (the `mediainfo --Output=JSON` CLI, or MediaInfo.js in the browser) to ATF tags.
// The sample tracks ship as mediainfo output; files dropped on the page will use the same path.

/** One `track` object from mediainfo's JSON: string values keyed by mediainfo's field names. */
export type MediaInfoTrack = Record<string, unknown> & { '@type'?: string }

export interface MediaInfoJson {
  media?: { track?: MediaInfoTrack[] }
}

/**
 * mediainfo General-track field → ATF field, copied as-is when present. Field names checked
 * against mediainfo.js 0.3.8's output for 2,340 real MP3, M4A, Opus, FLAC and Ogg files.
 */
const GENERAL: [string, string][] = [
  ['Title', 'title'],
  ['Performer', 'artist'],
  ['Album', 'album'],
  ['Album_Performer', 'albumartist'],
  ['Genre', 'genre'],
  ['Composer', 'composer'],
  ['Comment', 'comment'],
  ['ISRC', 'isrc'],
  ['BPM', 'bpm'],
  ['Conductor', 'conductor'],
  ['Lyricist', 'lyricist'],
  ['Producer', 'producer'],
  ['Director', 'director'],
  // The software that ripped or encoded the file (WACUP's doc: e.g. "WACUP 1.0.21.7236"):
  // MP4's ©too, Vorbis ENCODER, ffmpeg's Lavf…
  ['Encoded_Application', 'tool'],
  ['FileSize', 'filesize'],
  ['ReplayGain_Gain', 'replaygain_track_gain'],
  ['ReplayGain_Peak', 'replaygain_track_peak'],
]

/** A number tag without leading zeros (`0125` → `125`, `00` → `0`); anything else as written. */
const unpadded = (v: string) => (/^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, '') : v)

/**
 * A field value as a trimmed string. ID3v2.4 separates multiple values with NUL; they're joined
 * with ` / `, as MediaInfo itself shows them (empty parts, e.g. from a trailing NUL, are dropped).
 */
const str = (v: unknown) =>
  typeof v === 'string'
    ? v
        .split(/\0+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' / ')
    : typeof v === 'number'
      ? String(v)
      : ''

/** ATF tags for one file's mediainfo output. `filename` is the path to show (mediainfo's own is dropped). */
export function tagsFromMediaInfo(info: MediaInfoJson, filename: string): Record<string, string> {
  const tracks = info.media?.track ?? []
  const general = tracks.find((t) => t['@type'] === 'General') ?? {}
  const audio = tracks.find((t) => t['@type'] === 'Audio') ?? {}
  const tags: Record<string, string> = { filename }
  for (const [from, to] of GENERAL) {
    const v = str(general[from])
    if (v) tags[to] = v
  }
  // WACUP's %tracknumber% has no padding ("Track 1 will be displayed as 1").
  const track = str(general.Track_Position)
  if (track) tags.tracknumber = unpadded(track)
  // %disc% is the disc tag as WACUP shows it, e.g. 1/2 (disc 1 of a 2-CD set); mediainfo splits it.
  const disc = str(general.Part_Position)
  if (disc) {
    const total = str(general.Part_Position_Total)
    tags.disc = total ? `${unpadded(disc)}/${unpadded(total)}` : unpadded(disc)
  }
  // The record label: FLAC and Vorbis files often say LABEL rather than PUBLISHER.
  const publisher = str(general.Publisher) || str(general.Label)
  if (publisher) tags.publisher = publisher
  // The encoder (e.g. LAME 3.100): MP3 keeps it on the General track; FLAC, Opus and Ogg on the Audio one.
  const encoder = str(general.Encoded_Library) || str(audio.Encoded_Library)
  if (encoder) tags.encoder = encoder
  // 1 for video, 0 for audio (a cover picture is an Image track, not video).
  tags.type = tracks.some((t) => t['@type'] === 'Video') ? '1' : '0'
  // WACUP's %year% is the four-digit year: a 2020-07-17 tag shows as 2020. Anything else stays as written.
  const date = str(general.Recorded_Date) || str(general.Original_Released_Date)
  if (date) tags.year = /^\d{4}/.exec(date)?.[0] ?? date
  const duration = Number(str(general.Duration) || str(audio.Duration))
  if (duration > 0) tags.length_seconds = String(Math.round(duration))
  const bitrate = Number(str(audio.BitRate) || str(general.OverallBitRate))
  if (bitrate > 0) tags.bitrate = String(Math.round(bitrate / 1000))
  const rate = str(audio.SamplingRate)
  if (rate) tags.samplerate = rate
  const mode = str(audio.BitRate_Mode) || str(general.OverallBitRate_Mode)
  if (mode) tags.vbr = mode === 'VBR' ? '1' : '0'
  return tags
}
