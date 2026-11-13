/** One entry from an `.m3u` / `.m3u8` playlist. */
export interface PlaylistEntry {
  /** The path or URL line, as written. */
  filename: string
  /** `#EXTINF` duration in seconds (absent or -1 for streams). */
  lengthSeconds?: number
  /** `#EXTINF` title: what WACUP showed when it last wrote the playlist. A cache, not ground truth. */
  cachedTitle?: string
}

const EXTINF = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$/i

/**
 * Parse playlist text (pasted, or read from a dropped file). Only path lines become entries; an
 * `#EXTINF` line describes the next path. Tags aren't in a playlist, so they stay empty.
 */
export function parseM3u(text: string): PlaylistEntry[] {
  const out: PlaylistEntry[] = []
  let pending: { lengthSeconds?: number; cachedTitle?: string } = {}
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const inf = EXTINF.exec(line)
    if (inf) {
      const seconds = Number(inf[1])
      pending = { lengthSeconds: seconds >= 0 ? Math.round(seconds) : undefined, cachedTitle: inf[2] ?? '' }
      continue
    }
    if (line.startsWith('#')) continue
    out.push({ filename: line, ...pending })
    pending = {}
  }
  return out
}

/** `m:ss` (or `h:mm:ss`), the way a playlist shows a length. */
export function formatLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
