import SAMPLE_MEDIAINFO from './sample-mediainfo.json'
import { tagsFromMediaInfo, type MediaInfoJson } from './mediainfo'
import { formatLength, type PlaylistEntry } from './m3u'

/** A track the format is rendered for. `tags` holds what a tag editor would show; fields are derived from it. */
export interface Track {
  id: string
  tags: Record<string, string>
  /** For playlist imports: the `#EXTINF` title WACUP last wrote (a cache, possibly stale or hand-edited). */
  cachedTitle?: string
  source: 'sample' | 'playlist' | 'files' | 'custom'
}

/** The tag rows shown in the track editor, in a tag-editor-like order. */
export const EDITABLE_TAGS = [
  'artist', 'title', 'album', 'albumartist', 'tracknumber', 'disc', 'year', 'genre', 'composer', 'publisher', 'comment',
  'isrc', 'bitrate', 'samplerate', 'vbr', 'encoder', 'filename', 'length_seconds', 'rating',
] as const

/**
 * Field values the evaluator sees, keyed by lower-case field name. Adds the fields WACUP derives:
 * `%track%` = `%tracknumber%`, `%length%` as `m:ss`, `%folder%` / `%fullfolder%` from the path.
 */
export function fieldsFor(track: Track): Record<string, string> {
  const f: Record<string, string> = {}
  for (const [k, v] of Object.entries(track.tags)) if (v !== '') f[k.toLowerCase()] = v
  if (f.tracknumber && !f.track) f.track = f.tracknumber
  if (f.length_seconds && !f.length) {
    const s = Number(f.length_seconds)
    if (Number.isFinite(s)) f.length = formatLength(s)
  }
  if (f.filename) {
    const cut = Math.max(f.filename.lastIndexOf('\\'), f.filename.lastIndexOf('/'))
    if (cut > 0) {
      const dir = f.filename.slice(0, cut)
      f.fullfolder ??= dir + f.filename[cut]
      f.folder ??= dir.slice(Math.max(dir.lastIndexOf('\\'), dir.lastIndexOf('/')) + 1)
    }
  }
  return f
}

/** A one-line label for a track: the title, or the file name if there's no title. */
export function trackLabel(track: Track): string {
  const t = track.tags
  if (t.title) return t.artist ? `${t.artist} — ${t.title}` : t.title
  const file = t.filename ?? ''
  return file.slice(Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')) + 1) || '(empty track)'
}

let nextId = 1
export const newId = () => `t${nextId++}`

const sample = (tags: Record<string, string>): Track => ({ id: newId(), tags, source: 'sample' })

/**
 * Built-in tracks: tidy tags, patchy tags, and none at all, so recipes can show their fallbacks.
 * Four are real files' tags as mediainfo reads them (sample-mediainfo.json), quirks included:
 * downloader track numbers like `0172`, full release dates, a title still carrying its download
 * ID, a track with no artist. Dogs is the hand-made "complete tags" case; the last has no tags.
 */
const [alfie, oceans, juicy, frosk] = (SAMPLE_MEDIAINFO as { filename: string; media: MediaInfoJson['media'] }[]).map((e) =>
  sample(tagsFromMediaInfo({ media: e.media }, e.filename)),
)
export const SAMPLE_TRACKS: Track[] = [
  alfie,
  oceans,
  sample({
    artist: 'Pink Floyd', title: 'Dogs', album: 'Animals', albumartist: 'Pink Floyd',
    tracknumber: '2', year: '1977', genre: 'Progressive Rock', length_seconds: '1024',
    filename: 'D:\\Music\\Pink Floyd\\Animals\\02 Pink Floyd - Dogs.flac',
  }),
  juicy,
  frosk,
  sample({
    filename: 'C:\\Users\\Joe\\Downloads\\artist_-_song_title_(official_audio).mp3', length_seconds: '214',
  }),
]

/**
 * Tracks from a pasted or dropped playlist. A playlist has no tags, just the path and length.
 * `fileTags[i]`, when given, holds tags read from the audio file entry `i` names: they're merged
 * in, keeping the playlist's full path, and the file's own length wins over `#EXTINF`.
 */
export function tracksFromPlaylist(entries: PlaylistEntry[], fileTags: (Record<string, string> | undefined)[] = []): Track[] {
  return entries.map((e, i) => {
    const tags: Record<string, string> = e.lengthSeconds !== undefined ? { length_seconds: String(e.lengthSeconds) } : {}
    return { id: newId(), source: 'playlist', cachedTitle: e.cachedTitle, tags: { ...tags, ...fileTags[i], filename: e.filename } }
  })
}

/** Tracks from the user's own audio files, with the tags MediaInfo.js read from them. */
export function tracksFromFiles(fileTags: Record<string, string>[]): Track[] {
  return fileTags.map((tags) => ({ id: newId(), source: 'files', tags: { ...tags } }))
}
