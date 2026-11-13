import type MiniSearch from 'minisearch'
import type { Options, SearchOptions } from 'minisearch'
import type { Recipe } from './recipes'
import type { SavedFormat } from './saved'
import type { Setting } from './settings'

/**
 * The omnisearch: what it indexes, how results are shown, and where each result goes. MiniSearch
 * itself is loaded only when the search is first opened; everything here is plain functions.
 */
export type SearchKind = 'recipe' | 'saved' | 'function' | 'field' | 'rule' | 'setting' | 'wiki'

export const KIND_LABELS: Record<SearchKind, string> = {
  recipe: 'Recipe',
  saved: 'Saved',
  function: 'Function',
  field: 'Field',
  rule: 'Rule',
  setting: 'Setting',
  wiki: 'Wiki',
}

export interface SearchDoc {
  /** Unique across kinds: `kind:key`. */
  id: string
  kind: SearchKind
  /** Recipe title, saved id, function or field name, rule id, setting key, or wiki `Page#slug`. */
  key: string
  /** What the result shows: `$abbr`, `%artist%`, a recipe title… */
  title: string
  /** A function's signature, or a recipe's format. */
  sig: string
  /** Plain-text description. */
  body: string
  /** Wiki sections: the page name and heading anchor ('' for the top of the page). */
  page?: string
  anchor?: string
}

export interface CorpusInput {
  recipes: Recipe[]
  saved: SavedFormat[]
  functions: { name: string; sig: string; doc: string }[]
  fields: { name: string; doc: string }[]
  rules: { id: string; description: string }[]
  settings: Setting[]
  /** Wiki pages by file path (`…/wiki/Lint-Rules.md`), as raw Markdown. */
  wiki: Record<string, string>
}

// ---- text helpers -------------------------------------------------------------------------
/** Markdown to plain text, good enough for searching and snippets. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^```.*$/gm, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|[.,;:!?)]|$)/g, '$1$2')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * GitHub's heading anchors: lower case, anything but letters, digits, spaces, hyphens and
 * underscores dropped, spaces to hyphens. Repeats get `-1`, `-2`… (pass the same `used` map).
 */
export function githubSlug(heading: string, used = new Map<string, number>()): string {
  const base = stripMarkdown(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
  const n = used.get(base)
  used.set(base, (n ?? -1) + 1)
  return n === undefined ? base : `${base}-${n + 1}`
}

export interface WikiSection {
  page: string
  heading: string
  anchor: string
  text: string
}

/** A wiki page split into sections at its headings. The part before the first heading is the page itself. */
export function splitWiki(page: string, md: string): WikiSection[] {
  const pageTitle = page.replace(/-/g, ' ')
  const used = new Map<string, number>()
  const sections: WikiSection[] = []
  let current: WikiSection = { page, heading: pageTitle, anchor: '', text: '' }
  let fenced = false
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced
    const m = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      sections.push(current)
      const heading = m[2]!
      current = { page, heading: `${pageTitle} › ${stripMarkdown(heading)}`, anchor: githubSlug(heading, used), text: '' }
    } else {
      current.text += line + '\n'
    }
  }
  sections.push(current)
  return sections.map((s) => ({ ...s, text: stripMarkdown(s.text) })).filter((s) => s.text || s.anchor)
}

const pageName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

// ---- the corpus -----------------------------------------------------------------------------
export function buildDocs(input: CorpusInput): SearchDoc[] {
  const docs: SearchDoc[] = []
  const add = (kind: SearchKind, key: string, title: string, sig: string, body: string, extra: Partial<SearchDoc> = {}) =>
    docs.push({ id: `${kind}:${key}`, kind, key, title, sig, body, ...extra })
  for (const s of input.saved) add('saved', s.id, s.name, s.doc.split('\n').filter((l) => !l.startsWith('#')).join(''), 'Saved in this browser')
  for (const r of input.recipes) add('recipe', r.title, r.title, r.format, `${r.note} (${r.group})`)
  for (const f of input.functions) add('function', f.name, `$${f.name}`, f.sig, stripMarkdown(f.doc))
  for (const f of input.fields) add('field', f.name, `%${f.name}%`, '', stripMarkdown(f.doc))
  for (const r of input.rules) add('rule', r.id, r.id, '', stripMarkdown(r.description))
  for (const s of input.settings) add('setting', s.key, s.key, '', stripMarkdown(s.description))
  for (const [path, md] of Object.entries(input.wiki).sort(([a], [b]) => a.localeCompare(b))) {
    const page = pageName(path)
    for (const s of splitWiki(page, md)) add('wiki', `${page}#${s.anchor}`, s.heading, '', s.text, { page, anchor: s.anchor })
  }
  return docs
}

/** Words are runs of letters and digits, so `$abbr`, `%artist%` and `atf.lint.rules` split sensibly. */
export const tokenize = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

export const SEARCH_OPTIONS: SearchOptions = {
  prefix: true,
  fuzzy: 0.2,
  boost: { title: 3, sig: 1.5, body: 1 },
}

export const INDEX_OPTIONS: Options<SearchDoc> = {
  idField: 'id',
  fields: ['title', 'sig', 'body'],
  tokenize,
  searchOptions: SEARCH_OPTIONS,
}

export function createIndex(MiniSearchClass: typeof MiniSearch<SearchDoc>, docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const index = new MiniSearchClass(INDEX_OPTIONS)
  index.addAll(docs)
  return index
}

export interface Hit {
  doc: SearchDoc
  /** Document words that matched, for highlighting. */
  terms: string[]
}
export interface HitGroup {
  kind: SearchKind
  label: string
  hits: Hit[]
}

/** Hits grouped by kind, groups in the order of their best hit, at most `perGroup` each. */
export function groupHits(hits: Hit[], perGroup = 6): HitGroup[] {
  const groups = new Map<SearchKind, HitGroup>()
  for (const h of hits) {
    const g = groups.get(h.doc.kind) ?? { kind: h.doc.kind, label: KIND_LABELS[h.doc.kind], hits: [] }
    groups.set(h.doc.kind, g)
    if (g.hits.length < perGroup) g.hits.push(h)
  }
  return [...groups.values()]
}

/** Runs a query and maps the results back to their documents. */
export function runSearch(index: MiniSearch<SearchDoc>, byId: Map<string, SearchDoc>, query: string, limit = 40): Hit[] {
  if (!query.trim()) return []
  return index
    .search(query)
    .slice(0, limit)
    .flatMap((r) => {
      const doc = byId.get(String(r.id))
      return doc ? [{ doc, terms: r.terms }] : []
    })
}

// ---- highlighting ---------------------------------------------------------------------------
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function matchRanges(text: string, terms: string[]): [number, number][] {
  const words = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!words.length) return []
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  return [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length])
}

/** HTML for `text` with every whole-word match of `terms` in <mark>. The text is escaped first. */
export function highlight(text: string, terms: string[]): string {
  let out = ''
  let at = 0
  for (const [from, to] of matchRanges(text, terms)) {
    out += escapeHtml(text.slice(at, from)) + '<mark>' + escapeHtml(text.slice(from, to)) + '</mark>'
    at = to
  }
  return out + escapeHtml(text.slice(at))
}

/** About `max` characters of `text`, starting a little before the first match. */
export function snippet(text: string, terms: string[], max = 120): string {
  if (text.length <= max) return text
  const first = matchRanges(text, terms)[0]?.[0] ?? 0
  let start = Math.max(0, first - 30)
  if (start > 0) {
    const space = text.lastIndexOf(' ', start)
    start = space > 0 && start - space < 15 ? space + 1 : start
  }
  const end = Math.min(text.length, start + max)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

// ---- routing --------------------------------------------------------------------------------
/** What the playground does for a result, also carried in its URL hash from the docs page. */
export type PlaygroundAction = { kind: 'recipe'; title: string } | { kind: 'saved'; id: string } | { kind: 'ref'; target: string }

export type Route =
  | { type: 'action'; action: PlaygroundAction }
  /** Same tab. */
  | { type: 'href'; href: string }
  /** New tab. */
  | { type: 'external'; href: string }

export type SearchPage = 'playground' | 'docs'

export const WIKI_URL = 'https://github.com/GhostPirateBob/atf-syntax/wiki'

/**
 * The playground's action hash. It never has an `f` key, so it can't be taken for a share link
 * (`#f=…&s=…`), and a share link never parses as an action.
 */
export function encodeAction(action: PlaygroundAction): string {
  const params = new URLSearchParams()
  if (action.kind === 'recipe') params.set('recipe', action.title)
  else if (action.kind === 'saved') params.set('saved', action.id)
  else params.set('ref', action.target)
  return '#' + params.toString()
}

export function parseAction(hash: string): PlaygroundAction | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  if (params.has('f')) return undefined
  const recipe = params.get('recipe')
  if (recipe) return { kind: 'recipe', title: recipe }
  const saved = params.get('saved')
  if (saved) return { kind: 'saved', id: saved }
  const ref = params.get('ref')
  if (ref && /^(fn|field)-./.test(ref)) return { kind: 'ref', target: ref }
  return undefined
}

/**
 * Where a result goes. Recipes and saved formats load in the playground; functions and fields
 * open the playground's Reference tab when it lists them, else the docs page; rules and settings
 * are on the docs page; wiki sections open on GitHub in a new tab.
 */
export function routeFor(doc: SearchDoc, page: SearchPage, refListed: (target: string) => boolean = () => true): Route {
  const toPlayground = (action: PlaygroundAction): Route =>
    page === 'playground' ? { type: 'action', action } : { type: 'href', href: `../${encodeAction(action)}` }
  const toDocs = (anchor: string): Route => ({ type: 'href', href: page === 'docs' ? `#${anchor}` : `./extension/#${anchor}` })
  switch (doc.kind) {
    case 'recipe':
      return toPlayground({ kind: 'recipe', title: doc.key })
    case 'saved':
      return toPlayground({ kind: 'saved', id: doc.key })
    case 'function':
    case 'field': {
      const target = `${doc.kind === 'function' ? 'fn' : 'field'}-${doc.key}`
      return page === 'playground' && refListed(target) ? { type: 'action', action: { kind: 'ref', target } } : toDocs(target)
    }
    case 'rule':
      return toDocs(`rule-${doc.key}`)
    case 'setting':
      return toDocs(`setting-${doc.key}`)
    case 'wiki':
      return { type: 'external', href: `${WIKI_URL}/${encodeURIComponent(doc.page ?? '')}${doc.anchor ? `#${doc.anchor}` : ''}` }
  }
}

// ---- recent searches and picks ----------------------------------------------------------------
export type RecentItem = { type: 'query'; text: string } | { type: 'pick'; id: string; title: string; kind: SearchKind }

export const RECENT_KEY = 'atf-playground:recent-search'
export const RECENT_MAX = 8

const sameRecent = (a: RecentItem, b: RecentItem) =>
  a.type === 'query' && b.type === 'query' ? a.text.toLowerCase() === b.text.toLowerCase() : a.type === 'pick' && b.type === 'pick' && a.id === b.id

/** Newest first, no repeats, at most RECENT_MAX. */
export function addRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  if (item.type === 'query' && !item.text.trim()) return list
  return [item, ...list.filter((r) => !sameRecent(r, item))].slice(0, RECENT_MAX)
}

export function parseRecent(raw: string | null): RecentItem[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(list)) return []
    return list
      .filter(
        (r): r is RecentItem =>
          !!r &&
          ((r.type === 'query' && typeof r.text === 'string') ||
            (r.type === 'pick' && typeof r.id === 'string' && typeof r.title === 'string' && r.kind in KIND_LABELS)),
      )
      .slice(0, RECENT_MAX)
  } catch {
    return []
  }
}
