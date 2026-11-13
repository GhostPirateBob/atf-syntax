// Which dropped or picked files are audio or playlists, and which audio file a playlist entry names.
// Pure: no DOM, so the tests can run it.

/** Extensions read as audio files (MediaInfo.js reads their tags). */
export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'm4a', 'mp4', 'aac', 'ogg', 'opus', 'wav', 'wma', 'ape', 'wv', 'mpc', 'aiff', 'aif', 'dsf'] as const

/** Extensions read as playlists. */
export const PLAYLIST_EXTENSIONS = ['m3u', 'm3u8', 'txt'] as const

const ext = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}
export const isAudioName = (name: string) => (AUDIO_EXTENSIONS as readonly string[]).includes(ext(name))
export const isPlaylistName = (name: string) => (PLAYLIST_EXTENSIONS as readonly string[]).includes(ext(name))

const segments = (path: string) => path.toLowerCase().split(/[\\/]+/).filter(Boolean)

/**
 * For each playlist entry, the index of the file it names, or -1. Files match by file name,
 * ignoring case. When several files share that name (`01 Intro.mp3` in two albums), the one whose
 * relative path matches more of the entry's path tail wins (`Album B/01 Intro.mp3` for
 * `D:\Music\Album B\01 Intro.mp3`). A file can match more than one entry.
 */
export function matchPlaylistFiles(entries: readonly string[], files: readonly string[]): number[] {
  const fileSegs = files.map(segments)
  const byName = new Map<string, number[]>()
  fileSegs.forEach((segs, i) => {
    const name = segs[segs.length - 1]
    if (name === undefined) return
    const list = byName.get(name)
    if (list) list.push(i)
    else byName.set(name, [i])
  })
  return entries.map((entry) => {
    const e = segments(entry)
    let best = -1
    let bestTail = 0
    for (const i of byName.get(e[e.length - 1] ?? '') ?? []) {
      const f = fileSegs[i]!
      let tail = 0
      while (tail < f.length && tail < e.length && f[f.length - 1 - tail] === e[e.length - 1 - tail]) tail++
      if (tail > bestTail) {
        best = i
        bestTail = tail
      }
    }
    return best
  })
}
