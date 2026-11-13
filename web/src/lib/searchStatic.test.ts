import { describe, expect, it } from 'vitest'
import MiniSearch from 'minisearch'
import { staticCorpus } from './searchStatic'
import { INDEX_OPTIONS, buildDocs, createIndex, runSearch, type SearchDoc } from './search'

describe('search: the prebuilt index', () => {
  const { docs, index } = staticCorpus()
  const byId = new Map(docs.map((d) => [d.id, d]))
  // What the page gets: the index as JSON, restored with the same options.
  const restored = MiniSearch.loadJS<SearchDoc>(JSON.parse(JSON.stringify(index)), INDEX_OPTIONS)
  const built = createIndex(MiniSearch, docs)

  it('holds the fixed documents only (saved formats are added in the page)', () => {
    expect(docs.some((d) => d.kind === 'saved')).toBe(false)
    expect(new Set(docs.map((d) => d.kind))).toEqual(new Set(['recipe', 'function', 'field', 'rule', 'setting', 'wiki']))
  })
  it('searches like an index built from the same documents: the same hits in the same order', () => {
    // (The matched words within a hit may come in another order; they're used as a set.)
    const run = (i: MiniSearch<SearchDoc>, q: string) => runSearch(i, byId, q).map((h) => [h.doc.id, [...h.terms].sort()])
    for (const q of ['initials', 'abb', 'ifgraeter', 'artist', 'lint', 'wacup', 'ticker', 'i', 'replace empty']) expect(run(restored, q)).toEqual(run(built, q))
  })
  it('takes saved formats added afterwards, and lets them go again', () => {
    const saved = buildDocs({ recipes: [], saved: [{ id: 'x', name: 'Zebra format', doc: '%title%', savedAt: 1 }], functions: [], fields: [], rules: [], settings: [], wiki: {} })
    restored.addAll(saved)
    expect(runSearch(restored, new Map([...byId, ...saved.map((d) => [d.id, d] as const)]), 'zebra')[0]?.doc.id).toBe('saved:x')
    restored.discardAll(saved.map((d) => d.id))
    expect(runSearch(restored, byId, 'zebra')).toEqual([])
  })
})
