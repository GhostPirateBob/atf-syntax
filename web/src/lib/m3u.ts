import { oneLine } from './display'

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

/** A playlist row to export: the track's path and length, and what the playground rendered for it. */
export interface ExportRow {
  /** The path line, exactly as imported. */
  filename: string
  /** `%length_seconds%` as a string (a tag value), or a number; anything unusable gives `-1`. */
  lengthSeconds?: string | number
  /** The rendered title (after WACUP's display habits). */
  text: string
  state: 'ok' | 'freeze' | 'heavy' | 'error' | 'timeout' | 'pending'
  /** The `#EXTINF` title the imported playlist had. */
  cachedTitle?: string
}

/** States with no title to write: WACUP would hang, the preview gave up, or it hasn't finished. */
const NO_TITLE: ReadonlySet<ExportRow['state']> = new Set(['freeze', 'heavy', 'timeout', 'pending'])

const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)

/**
 * The title to write for a row: the rendered text, or, when there's none to write, the cached
 * `#EXTINF` title, else the file name. `reason` says why: `blocked` (see `NO_TITLE`) or `empty`
 * (the format rendered nothing for this track).
 */
export function exportTitle(row: ExportRow): { title: string; fallback: boolean; reason?: 'blocked' | 'empty' } {
  const reason = NO_TITLE.has(row.state) ? 'blocked' : row.text === '' ? 'empty' : undefined
  if (!reason) return { title: oneLine(row.text), fallback: false }
  return { title: oneLine(row.cachedTitle || baseName(row.filename)), fallback: true, reason }
}

const exportSeconds = (raw: ExportRow['lengthSeconds']) => {
  const s = typeof raw === 'number' ? raw : raw?.trim() ? Number(raw) : NaN
  return Number.isFinite(s) && s >= 0 ? Math.round(s) : -1
}

/**
 * The rows as an `.m3u8` in the format WACUP writes `winamp.m3u8` (checked against its own files):
 * a UTF-8 BOM, LF line endings (not CRLF), `#EXTM3U`, then `#EXTINF:<seconds>,<title>` and the
 * path for each track, with no spaces around the colon or comma, and a final LF. `-1` seconds = unknown.
 */
export function toM3u8(rows: readonly ExportRow[]): string {
  const lines = ['#EXTM3U']
  for (const row of rows) lines.push(`#EXTINF:${exportSeconds(row.lengthSeconds)},${exportTitle(row).title}`, row.filename)
  return '﻿' + lines.join('\n') + '\n'
}

/** `m:ss` (or `h:mm:ss`), the way a playlist shows a length. */
export function formatLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
