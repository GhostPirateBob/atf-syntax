// Loaded on first use of the search, or when the page is idle (a dynamic import), so MiniSearch and
// the corpus stay out of the page's first download. The fixed part of the corpus comes with its
// index already built (`virtual:search-index`, made at build time by vite.config.ts from
// lib/searchStatic.ts); only the saved formats, which live in this browser, are indexed here.
import MiniSearch from 'minisearch'
import { docs, index } from 'virtual:search-index'
import type { SavedFormat } from './saved'
import { INDEX_OPTIONS, buildDocs, runSearch, type Hit, type SearchDoc } from './search'

export interface Searcher {
  search(query: string): Hit[]
  byId: Map<string, SearchDoc>
  /** Replaces the saved formats in the index (they change while the page is open). */
  setSaved(saved: SavedFormat[]): void
}

const savedDocs = (saved: SavedFormat[]) =>
  buildDocs({ recipes: [], saved, functions: [], fields: [], rules: [], settings: [], wiki: {} })

/** The searcher, its index restored in slices (no long task), with `saved` added. */
export async function makeSearcher(saved: SavedFormat[]): Promise<Searcher> {
  const mini = await MiniSearch.loadJSAsync<SearchDoc>(index, INDEX_OPTIONS)
  const byId = new Map(docs.map((d) => [d.id, d]))
  let savedIds: string[] = []
  const setSaved = (list: SavedFormat[]) => {
    for (const id of savedIds) byId.delete(id)
    if (savedIds.length) mini.discardAll(savedIds)
    const fresh = savedDocs(list)
    mini.addAll(fresh)
    for (const d of fresh) byId.set(d.id, d)
    savedIds = fresh.map((d) => d.id)
  }
  setSaved(saved)
  return { search: (q) => runSearch(mini, byId, q), byId, setSaved }
}
