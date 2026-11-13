import { describe, expect, it } from 'vitest'
import type { StorageLike } from './saved'
import type { Track } from './tracks'
import { TRACKS_KEY, TRACKS_VERSION, clearTracks, parseTracks, readTracks, serialiseTracks, writeTracks, type RememberedTracks } from './savedTracks'

function fakeStorage(opts: { blocked?: boolean; quota?: number } = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => {
      if (opts.blocked) throw new Error('blocked')
      return data.get(k) ?? null
    },
    setItem: (k, v) => {
      if (opts.blocked || (opts.quota !== undefined && v.length > opts.quota)) throw new Error('QuotaExceededError')
      data.set(k, v)
    },
    removeItem: (k) => {
      if (opts.blocked) throw new Error('blocked')
      data.delete(k)
    },
  }
}

const track = (i: number, extra: Partial<Track> = {}): Track => ({
  id: `t${i}`,
  source: 'playlist',
  path: `D:\\Music\\${i}.flac`,
  cachedTitle: `Cached ${i}`,
  tags: { filename: `D:\\Music\\${i}.flac`, length_seconds: String(100 + i), title: `Title ${i}` },
  ...extra,
})
const list = (n: number, over: Partial<RememberedTracks> = {}): RememberedTracks => ({ source: 'playlist', tracks: Array.from({ length: n }, (_, i) => track(i)), selected: 2, tagged: 1, ...over })

describe('remembered playlist', () => {
  it('round-trips tags, path, cached title, source, selection and the tagged count', () => {
    const store = fakeStorage()
    expect(writeTracks(store, list(4))).toBe(4)
    const back = readTracks(store)!
    expect(back.source).toBe('playlist')
    expect(back.selected).toBe(2)
    expect(back.tagged).toBe(1)
    expect(back.tracks.map((t) => [t.tags, t.path, t.cachedTitle, t.source])).toEqual(list(4).tracks.map((t) => [t.tags, t.path, t.cachedTitle, 'playlist']))
    // Fresh ids, so restored tracks never clash with ones made later.
    expect(new Set(back.tracks.map((t) => t.id)).size).toBe(4)
    expect(JSON.parse(store.data.get(TRACKS_KEY)!).v).toBe(TRACKS_VERSION)
  })
  it('stores only metadata: no ids or anything else on the track', () => {
    const t = { ...track(1), file: new Blob(['audio']) } as unknown as Track
    const stored = JSON.parse(serialiseTracks({ source: 'files', tracks: [t], selected: 0, tagged: 0 }).json!)
    expect(Object.keys(stored.tracks[0]).sort()).toEqual(['cachedTitle', 'path', 'tags'])
  })
  it('keeps the first tracks that fit when the list is too big, or none', () => {
    const big = list(50)
    const whole = serialiseTracks(big).json!.length
    const cut = serialiseTracks(big, Math.floor(whole / 2))
    expect(cut.kept).toBeGreaterThan(0)
    expect(cut.kept).toBeLessThan(50)
    expect(cut.json!.length).toBeLessThanOrEqual(Math.floor(whole / 2))
    expect(parseTracks(cut.json)!.tracks).toHaveLength(cut.kept)
    expect(serialiseTracks(big, 10)).toEqual({ kept: 0 })
    const store = fakeStorage()
    store.data.set(TRACKS_KEY, 'old')
    expect(writeTracks(store, big, 10)).toBe(0)
    expect(store.data.has(TRACKS_KEY)).toBe(false)
  })
  it("survives storage that's blocked or full", () => {
    expect(writeTracks(fakeStorage({ blocked: true }), list(3))).toBe(0)
    expect(readTracks(fakeStorage({ blocked: true }))).toBeNull()
    expect(writeTracks(fakeStorage({ quota: 5 }), list(3))).toBe(0)
    expect(writeTracks(undefined, list(3))).toBe(0)
    expect(() => clearTracks(fakeStorage({ blocked: true }))).not.toThrow()
  })
  it('ignores other versions and malformed data, and drops bad tracks', () => {
    const ok = { v: TRACKS_VERSION, source: 'files', selected: 0, tagged: 0, tracks: [{ tags: { title: 'a' } }] }
    for (const raw of [null, '', '{', '[]', '"x"', JSON.stringify({ ...ok, v: 99 }), JSON.stringify({ ...ok, source: 'sample' }), JSON.stringify({ ...ok, tracks: 'no' }), JSON.stringify({ ...ok, tracks: [] }), JSON.stringify({ ...ok, tracks: [{ tags: { title: 3 } }, null] })]) {
      expect(parseTracks(raw), String(raw)).toBeNull()
    }
    const mixed = parseTracks(JSON.stringify({ ...ok, selected: 9, tagged: -1, tracks: [{ tags: { title: 'a' } }, { tags: 'x' }, { tags: { title: 'b' }, path: 5 }] }))!
    expect(mixed.tracks.map((t) => t.tags.title)).toEqual(['a', 'b'])
    expect(mixed.tracks[1]!.path).toBeUndefined()
    expect(mixed.selected).toBe(1)
    expect(mixed.tagged).toBe(0)
  })
  it('clears', () => {
    const store = fakeStorage()
    writeTracks(store, list(2))
    clearTracks(store)
    expect(readTracks(store)).toBeNull()
  })
})

describe('serialiseTracks in one pass', () => {
  it('writes the same JSON as stringifying the whole record', () => {
    const r = list(5)
    const stored = r.tracks.map((t) => ({ tags: t.tags, ...(t.path !== undefined && { path: t.path }), ...(t.cachedTitle !== undefined && { cachedTitle: t.cachedTitle }) }))
    expect(serialiseTracks(r).json).toBe(JSON.stringify({ v: TRACKS_VERSION, source: r.source, selected: r.selected, tagged: r.tagged, tracks: stored }))
  })

  it('keeps the longest prefix that fits: one more track would not', () => {
    const big = list(300)
    for (const max of [5_000, 12_345, 40_000]) {
      const cut = serialiseTracks(big, max)
      expect(cut.json!.length).toBeLessThanOrEqual(max)
      const more = serialiseTracks({ ...big, tracks: big.tracks.slice(0, cut.kept + 1) }, Infinity)
      expect(more.json!.length).toBeGreaterThan(max)
    }
  })
})
