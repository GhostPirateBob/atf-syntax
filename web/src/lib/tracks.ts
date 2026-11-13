import { formatLength, type PlaylistEntry } from './m3u'

/** A track the format is rendered for. `tags` holds what a tag editor would show; fields are derived from it. */
export interface Track {
  id: string
  tags: Record<string, string>
  /** For playlist imports: the `#EXTINF` title WACUP last wrote (a cache, possibly stale or hand-edited). */
  cachedTitle?: string
  source: 'sample' | 'playlist' | 'custom'
}

/** The tag rows shown in the track editor, in a tag-editor-like order. */
export const EDITABLE_TAGS = ['artist', 'title', 'album', 'albumartist', 'tracknumber', 'disc', 'year', 'genre', 'filename', 'length_seconds', 'rating'] as const

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

/** Built-in tracks: tidy tags, patchy tags, and none at all, so recipes can show their fallbacks. */
export const SAMPLE_TRACKS: Track[] = [
  sample({
    artist: 'Alfie Templeman', title: 'Things I Thought Were Mine', album: 'Happiness in Liquid Form', albumartist: 'Alfie Templeman',
    tracknumber: '2', year: '2022', genre: 'Indie Pop', length_seconds: '193',
    filename: 'D:\\Music\\Alfie Templeman\\Happiness in Liquid Form\\02 Alfie Templeman - Things I Thought Were Mine.mp3',
  }),
  sample({
    artist: 'JAY-Z feat. Frank Ocean', title: 'Oceans', album: 'Magna Carta... Holy Grail', albumartist: 'JAY-Z',
    tracknumber: '5', year: '2013', genre: 'Hip-Hop', length_seconds: '238',
    filename: 'D:\\Music\\JAY-Z\\Magna Carta... Holy Grail\\05 JAY-Z - Oceans.mp3',
  }),
  sample({
    artist: 'Pink Floyd', title: 'Dogs', album: 'Animals', albumartist: 'Pink Floyd',
    tracknumber: '2', year: '1977', genre: 'Progressive Rock', length_seconds: '1024',
    filename: 'D:\\Music\\Pink Floyd\\Animals\\02 Pink Floyd - Dogs.flac',
  }),
  sample({
    artist: 'The Notorious B.I.G.', title: 'Juicy', album: 'Ready to Die', year: '1994', length_seconds: '305',
    filename: 'D:\\Music\\The Notorious B.I.G\\Ready to Die\\Juicy.mp3',
  }),
  sample({
    artist: 'Kristian Pedersen', title: 'Kaptein Frosk', album: 'SoundCloud', albumartist: 'Kristian Pedersen',
    year: '2016', length_seconds: '101',
    filename: 'D:\\Music\\__ASSORTED\\Kaptein Frosk (music video in description).mp3',
  }),
  sample({
    filename: 'C:\\Users\\Joe\\Downloads\\artist_-_song_title_(official_audio).mp3', length_seconds: '214',
  }),
]

/** Tracks from a pasted or dropped playlist: just the path and length, as a playlist has no tags. */
export function tracksFromPlaylist(entries: PlaylistEntry[]): Track[] {
  return entries.map((e) => ({
    id: newId(),
    source: 'playlist',
    cachedTitle: e.cachedTitle,
    tags: { filename: e.filename, ...(e.lengthSeconds !== undefined ? { length_seconds: String(e.lengthSeconds) } : {}) },
  }))
}
