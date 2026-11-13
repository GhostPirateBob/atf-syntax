// MediaInfo JSON (the `mediainfo --Output=JSON` CLI, or MediaInfo.js in the browser) to ATF tags.
// The sample tracks ship as mediainfo output; files dropped on the page will use the same path.

/** One `track` object from mediainfo's JSON: string values keyed by mediainfo's field names. */
export type MediaInfoTrack = Record<string, unknown> & { '@type'?: string }

export interface MediaInfoJson {
  media?: { track?: MediaInfoTrack[] }
}

/** mediainfo General-track field → ATF field, copied as-is when present. */
const GENERAL: [string, string][] = [
  ['Title', 'title'],
  ['Performer', 'artist'],
  ['Album', 'album'],
  ['Album_Performer', 'albumartist'],
  ['Track_Position', 'tracknumber'],
  ['Part_Position', 'disc'],
  ['Recorded_Date', 'year'],
  ['Genre', 'genre'],
  ['Composer', 'composer'],
  ['Publisher', 'publisher'],
  ['Comment', 'comment'],
  ['ISRC', 'isrc'],
  ['BPM', 'bpm'],
  ['Conductor', 'conductor'],
  ['Lyricist', 'lyricist'],
  ['Encoded_Library', 'encoder'],
  ['FileSize', 'filesize'],
  ['ReplayGain_Gain', 'replaygain_track_gain'],
  ['ReplayGain_Peak', 'replaygain_track_peak'],
]

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

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
