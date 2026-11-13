// Run at build time (and by the dev server), not in the page: the search's fixed documents
// (recipes, functions, fields, lint rules, settings and the wiki) and their MiniSearch index,
// serialised. vite.config.ts turns the result into the `virtual:search-index` module, so the page
// restores the index (MiniSearch.loadJSAsync) instead of building it from the texts on first use.
import MiniSearch from 'minisearch'
import { FIELDS, FUNCTIONS, RULES } from '@/core'
import pkg from '@pkg'
import { RECIPES } from './recipes'
import { settingsFrom } from './settings'
import { buildDocs, createIndex, type SearchDoc } from './search'

/** The repo's wiki pages (wiki/*.md), as text. */
const WIKI = import.meta.glob('../../../wiki/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function staticCorpus(): { docs: SearchDoc[]; index: ReturnType<MiniSearch<SearchDoc>['toJSON']> } {
  const docs = buildDocs({
    recipes: RECIPES,
    saved: [],
    functions: FUNCTIONS,
    fields: FIELDS,
    rules: Object.values(RULES),
    settings: settingsFrom(pkg),
    wiki: WIKI,
  })
  return { docs, index: createIndex(MiniSearch, docs).toJSON() }
}
