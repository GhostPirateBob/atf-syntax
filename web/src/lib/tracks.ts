import SAMPLE_MEDIAINFO from './sample-mediainfo.json'
import { tagsFromMediaInfo, type MediaInfoJson } from './mediainfo'
import { formatLength, type PlaylistEntry } from './m3u'

/** A track the format is rendered for. `tags` holds what a tag editor would show; fields are derived from it. */
export interface Track {
  id: string
  tags: Record<string, string>
  /** For playlist imports: the `#EXTINF` title WACUP last wrote (a cache, possibly stale or hand-edited). */
  cachedTitle?: string
  /** For playlist imports: the path line as written, kept apart from the editable `filename` tag. */
  path?: string
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
 * With `playlist`, also `%playlist_position%` (1-based) and `%playlist_length%` (track count),
 * which come from the playlist, not the file's tags.
 */
export function fieldsFor(track: Track, playlist?: { position: number; length: number }): Record<string, string> {
  const f: Record<string, string> = {}
  for (const [k, v] of Object.entries(track.tags)) if (v !== '') f[k.toLowerCase()] = v
  if (playlist) {
    f.playlist_position = String(playlist.position)
    f.playlist_length = String(playlist.length)
  }
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

/** The track's length the way a playlist shows it (`m:ss`, or `h:mm:ss`), or '' if unknown. */
export function durationOf(track: Track): string {
  const raw = track.tags.length_seconds
  if (!raw) return ''
  const s = Number(raw)
  return Number.isFinite(s) && s >= 0 ? formatLength(s) : ''
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
 * Built-in tracks, tidy and patchy, so recipes can show their fallbacks. First, every entry in
 * sample-mediainfo.json (real files' tags as mediainfo reads them, quirks included, e.g.
 * downloader track numbers like `0172` and full release dates), however many there are. Then
 * Dogs, the hand-made "complete tags" case.
 */
const fromMediaInfo = (SAMPLE_MEDIAINFO as { filename: string; media: MediaInfoJson['media'] }[]).map((e) =>
  sample(tagsFromMediaInfo({ media: e.media }, e.filename)),
)
export const SAMPLE_TRACKS: Track[] = [
  ...fromMediaInfo,
  sample({
    artist: 'Pink Floyd', title: 'Dogs', album: 'Animals', albumartist: 'Pink Floyd',
    tracknumber: '2', year: '1977', genre: 'Progressive Rock', length_seconds: '1024',
    filename: 'D:\\Music\\Pink Floyd\\Animals\\02 Pink Floyd - Dogs.flac',
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
    return { id: newId(), source: 'playlist', cachedTitle: e.cachedTitle, path: e.filename, tags: { ...tags, ...fileTags[i], filename: e.filename } }
  })
}

/** Tracks from the user's own audio files, with the tags MediaInfo.js read from them. */
export function tracksFromFiles(fileTags: Record<string, string>[]): Track[] {
  return fileTags.map((tags) => ({ id: newId(), source: 'files', tags: { ...tags } }))
}
