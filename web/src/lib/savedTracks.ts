import { newId, type Track } from './tracks'
import type { StorageLike } from './saved'

/**
 * The last playlist or set of files the user loaded, remembered in this browser so a reload brings
 * it back. Only the metadata already held in memory is kept: each track's tags (as read by
 * MediaInfo or typed in), its playlist path and cached #EXTINF title. Never file contents.
 */
export const TRACKS_KEY = 'atf-playground:tracks'
export const TRACKS_VERSION = 1
/** About 2 MB of JSON at most; a longer list keeps its first tracks that fit. */
export const MAX_TRACKS_JSON = 2_000_000

export interface RememberedTracks {
  source: 'playlist' | 'files'
  tracks: Track[]
  selected: number
  /** Playlist tracks that got tags from the user's files (for the "N with tags" label). */
  tagged: number
}

interface StoredTrack {
  tags: Record<string, string>
  path?: string
  cachedTitle?: string
}

const toStored = (t: Track): StoredTrack => ({ tags: t.tags, ...(t.path !== undefined && { path: t.path }), ...(t.cachedTitle !== undefined && { cachedTitle: t.cachedTitle }) })

/**
 * The JSON to store, and how many tracks it holds: all of them, or the first ones that fit in
 * `max` characters. Zero tracks fit: `json` is undefined.
 */
export function serialiseTracks(r: RememberedTracks, max = MAX_TRACKS_JSON): { json?: string; kept: number } {
  const build = (n: number) =>
    JSON.stringify({ v: TRACKS_VERSION, source: r.source, selected: Math.min(r.selected, Math.max(0, n - 1)), tagged: Math.min(r.tagged, n), tracks: r.tracks.slice(0, n).map(toStored) })
  const all = build(r.tracks.length)
  if (all.length <= max) return { json: all, kept: r.tracks.length }
  // The longest prefix that fits, by bisection.
  let lo = 0
  let hi = r.tracks.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (build(mid).length <= max) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? { json: build(lo), kept: lo } : { kept: 0 }
}

const isStrings = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string')

/** A stored list, or null if there's none, it's from another version, or it's malformed. Bad tracks are dropped. */
export function parseTracks(raw: string | null | undefined): RememberedTracks | null {
  let v: unknown
  try {
    v = JSON.parse(raw ?? 'null')
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.v !== TRACKS_VERSION || (o.source !== 'playlist' && o.source !== 'files') || !Array.isArray(o.tracks)) return null
  const source = o.source
  const tracks: Track[] = []
  for (const t of o.tracks as unknown[]) {
    if (!t || typeof t !== 'object') continue
    const s = t as Record<string, unknown>
    if (!isStrings(s.tags)) continue
    tracks.push({
      id: newId(),
      source,
      tags: { ...s.tags },
      ...(typeof s.path === 'string' && { path: s.path }),
      ...(typeof s.cachedTitle === 'string' && { cachedTitle: s.cachedTitle }),
    })
  }
  if (!tracks.length) return null
  const int = (x: unknown, max: number) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? Math.min(x, max) : 0)
  return { source, tracks, selected: int(o.selected, tracks.length - 1), tagged: int(o.tagged, tracks.length) }
}

export function readTracks(store: Pick<StorageLike, 'getItem'> | undefined): RememberedTracks | null {
  try {
    return parseTracks(store?.getItem(TRACKS_KEY))
  } catch {
    return null
  }
}

/**
 * Remembers the list. Returns how many tracks were stored (fewer than given when it's too big), or
 * 0 if none could be (storage blocked or full, or not even one track fits).
 */
export function writeTracks(store: Pick<StorageLike, 'setItem' | 'removeItem'> | undefined, r: RememberedTracks, max = MAX_TRACKS_JSON): number {
  const { json, kept } = serialiseTracks(r, max)
  try {
    if (!store) return 0
    if (!json) {
      store.removeItem(TRACKS_KEY)
      return 0
    }
    store.setItem(TRACKS_KEY, json)
    return kept
  } catch {
    try {
      store?.removeItem(TRACKS_KEY)
    } catch {
      /* nothing more to do */
    }
    return 0
  }
}

export function clearTracks(store: Pick<StorageLike, 'removeItem'> | undefined): void {
  try {
    store?.removeItem(TRACKS_KEY)
  } catch {
    /* not stored anyway */
  }
}
