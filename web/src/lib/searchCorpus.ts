// Loaded on first use of the search (a dynamic import), so MiniSearch, the wiki pages and the
// extension manifest stay out of the page's first download.
import MiniSearch from 'minisearch'
import { FIELDS, FUNCTIONS, RULES } from '@/core'
import pkg from '@pkg'
import { RECIPES } from './recipes'
import type { SavedFormat } from './saved'
import { settingsFrom } from './settings'
import { buildDocs, createIndex, runSearch, type Hit, type SearchDoc } from './search'

/** The repo's wiki pages (wiki/*.md), bundled as text. */
const WIKI = import.meta.glob('../../../wiki/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const SETTINGS = settingsFrom(pkg)

export interface Searcher {
  search(query: string): Hit[]
  byId: Map<string, SearchDoc>
}

export function makeSearcher(saved: SavedFormat[]): Searcher {
  const docs = buildDocs({
    recipes: RECIPES,
    saved,
    functions: FUNCTIONS,
    fields: FIELDS,
    rules: Object.values(RULES),
    settings: SETTINGS,
    wiki: WIKI,
  })
  const index = createIndex(MiniSearch, docs)
  const byId = new Map(docs.map((d) => [d.id, d]))
  return { search: (q) => runSearch(index, byId, q), byId }
}
