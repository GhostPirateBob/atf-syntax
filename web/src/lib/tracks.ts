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

/**
 * Built-in tracks: tidy tags, patchy tags, and none at all, so recipes can show their fallbacks.
 * The tags are what mediainfo reads from real files, quirks included (track numbers like `0172`
 * from a downloader, full release dates, a title still carrying its download ID, no artist).
 * Dogs has no file behind it; it's the hand-made "complete tags" case.
 */
export const SAMPLE_TRACKS: Track[] = [
  sample({
    artist: 'Alfie Templeman', title: 'Things I Thought Were Mine', album: 'Happiness in Liquid Form', albumartist: 'Alfie Templeman',
    tracknumber: '0172', disc: '1', year: '2020-07-17', length_seconds: '193',
    bitrate: '320', samplerate: '48000', vbr: '0', encoder: 'Lavc61.8.',
    filename: 'D:\\Music\\Alfie Templeman\\Happiness in Liquid Form\\02 Alfie Templeman - Things I Thought Were Mine.mp3',
  }),
  sample({
    artist: 'JAY-Z feat. Frank Ocean', title: 'Oceans', album: 'Magna Carta... Holy Grail', albumartist: 'JAY-Z',
    tracknumber: '0683', disc: '1', year: '2013-07-08', length_seconds: '238',
    bitrate: '320', samplerate: '48000', vbr: '0',
    filename: 'D:\\Music\\JAY-Z\\Magna Carta... Holy Grail\\05 JAY-Z feat. Frank Ocean - Oceans.mp3',
  }),
  sample({
    artist: 'Pink Floyd', title: 'Dogs', album: 'Animals', albumartist: 'Pink Floyd',
    tracknumber: '2', year: '1977', genre: 'Progressive Rock', length_seconds: '1024',
    filename: 'D:\\Music\\Pink Floyd\\Animals\\02 Pink Floyd - Dogs.flac',
  }),
  sample({
    artist: 'The Notorious B.I.G.', title: 'Juicy', album: 'Ready to Die', albumartist: 'The Notorious B.I.G.',
    tracknumber: '1457', disc: '1', year: '1994-09-13', length_seconds: '303',
    bitrate: '216', samplerate: '44100', vbr: '1', encoder: 'LAME3.90.',
    filename: 'D:\\Music\\The Notorious B.I.G_\\Ready to Die\\10 Juicy.mp3',
  }),
  sample({
    title: 'Kaptein Frosk (music video in description)-291000340', comment: 'b', length_seconds: '102',
    bitrate: '320', samplerate: '44100', vbr: '0', encoder: 'Lavc61.8.',
    filename: 'D:\\Music\\ZZ_LOOSE\\Kaptein Frosk (music video in description)-291000340.mp3',
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
