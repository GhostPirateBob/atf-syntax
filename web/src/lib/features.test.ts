import { describe, expect, it } from 'vitest'
import MiniSearch from 'minisearch'
import { FIELDS, FUNCTIONS } from '@core/catalog'
import { RULES as LINT_RULES } from '@core/lint'
import { RECIPES, nextActiveRecipe, showsDuration, type Recipe } from './recipes'
import { toFormat } from './document'
import { formatDoc } from './formatDoc'
import { oneLine } from './display'
import { SAMPLE_TRACKS, fieldsFor } from './tracks'
import { evaluate } from '@core/evaluate'
import { decodeShare, encodeShare } from './share'
import { DEFAULT_VIEW, parseView } from './view'
import {
  addRecent,
  buildDocs,
  createIndex,
  encodeAction,
  githubSlug,
  groupHits,
  highlight,
  parseAction,
  parseRecent,
  RECENT_MAX,
  routeFor,
  runSearch,
  snippet,
  splitWiki,
  stripMarkdown,
  type CorpusInput,
  type SearchDoc,
} from './search'
import {
  addSaved,
  defaultSaveName,
  deleteSaved,
  initialDoc,
  LAST_KEY,
  loadSaved,
  readLast,
  renameSaved,
  SAVED_KEY,
  undoDelete,
  writeLast,
  writeSaved,
  type StorageLike,
} from './saved'


/** An in-memory Storage, optionally one that throws like a blocked localStorage. */
function fakeStorage(blocked = false): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  const guard = () => {
    if (blocked) throw new DOMException('denied', 'SecurityError')
  }
  return {
    data,
    getItem: (k) => (guard(), data.get(k) ?? null),
    setItem: (k, v) => (guard(), void data.set(k, v)),
    removeItem: (k) => (guard(), void data.delete(k)),
  }
}

const WIKI_MD = `Intro text about the wiki page.

## Install the extension
Run \`code --install-extension\`.

## Install the extension
Again, a repeated heading.

\`\`\`
## not a heading inside a fence
\`\`\`

### What's new? (v0.3)
Stuff.
`

const corpus = (over: Partial<CorpusInput> = {}): CorpusInput => ({
  recipes: RECIPES,
  saved: [],
  functions: FUNCTIONS,
  fields: FIELDS,
  rules: Object.values(LINT_RULES),
  settings: [{ key: 'atf.format.lineWidth', type: 'number', description: 'Wrap long formats at **top-level** boundaries.' }],
  wiki: { '../../../wiki/Formatting.md': WIKI_MD },
  ...over,
})

describe('search: wiki sections and slugs', () => {
  it('makes GitHub heading anchors, numbering repeats', () => {
    const used = new Map<string, number>()
    expect(githubSlug('Install the extension', used)).toBe('install-the-extension')
    expect(githubSlug('Install the extension', used)).toBe('install-the-extension-1')
    expect(githubSlug("What's new? (v0.3)")).toBe('whats-new-v03')
    expect(githubSlug('`$if` and **bold**')).toBe('if-and-bold')
    expect(githubSlug('Ünïcode héading')).toBe('ünïcode-héading')
  })
  it('splits a page at its headings, ignoring fenced code', () => {
    const s = splitWiki('Formatting', WIKI_MD)
    expect(s.map((x) => x.anchor)).toEqual(['', 'install-the-extension', 'install-the-extension-1', 'whats-new-v03'])
    expect(s[0]!.heading).toBe('Formatting')
    expect(s[1]!.heading).toBe('Formatting › Install the extension')
    expect(s[2]!.text).toContain('not a heading inside a fence')
  })
  it('strips Markdown to plain text', () => {
    expect(stripMarkdown('A [link](https://x.y) with `code` and **bold** | cell |')).toBe('A link with code and bold cell')
    expect(stripMarkdown('<!-- generated -->\n| a | b |\n|---|---|\n| c | d |')).toBe('a b c d')
  })
})

describe('search: the index', () => {
  const docs = buildDocs(corpus({ saved: [{ id: 's1', name: 'My ticker', doc: '# note\n%artist%\n - %title%', savedAt: 1 }] }))
  const byId = new Map(docs.map((d) => [d.id, d]))
  const index = createIndex(MiniSearch, docs)
  const search = (q: string) => runSearch(index, byId, q)

  it('indexes every source, with unique ids', () => {
    const kinds = new Set(docs.map((d) => d.kind))
    expect([...kinds].sort()).toEqual(['field', 'function', 'recipe', 'rule', 'saved', 'setting', 'wiki'])
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length)
    expect(docs.filter((d) => d.kind === 'recipe')).toHaveLength(RECIPES.length)
    expect(docs.filter((d) => d.kind === 'function')).toHaveLength(FUNCTIONS.length)
    // A saved format is indexed as its joined format, without comment lines.
    expect(byId.get('saved:s1')!.sig).toBe('%artist% - %title%')
  })
  it('finds by prefix and with typos, names before mentions', () => {
    expect(search('abb')[0]!.doc.id).toBe('function:abbr')
    expect(search('ifgraeter')[0]!.doc.id).toBe('function:ifgreater')
    expect(search('$puts')[0]!.doc.id).toBe('function:puts')
    expect(search('%albumartist%')[0]!.doc.id).toBe('field:albumartist')
    expect(search('replace-empty-search')[0]!.doc.id).toBe('rule:replace-empty-search')
    expect(search('linewidth')[0]!.doc.id).toBe('setting:atf.format.lineWidth')
    expect(search('ticker').some((h) => h.doc.id === 'saved:s1')).toBe(true)
    expect(search('repeated heading')[0]!.doc.id).toBe('wiki:Formatting#install-the-extension-1')
  })
  it('groups hits by kind in order of the best hit', () => {
    const groups = groupHits(search('abbr'), 3)
    expect(groups[0]!.kind).toBe('function')
    expect(groups.every((g) => g.hits.length <= 3)).toBe(true)
    expect(new Set(groups.map((g) => g.kind)).size).toBe(groups.length)
  })
})

describe('search: highlighting', () => {
  it('escapes HTML first, then marks whole-word matches', () => {
    expect(highlight('<b>Artist</b> & artists', ['artist'])).toBe('&lt;b&gt;<mark>Artist</mark>&lt;/b&gt; &amp; artists')
    expect(highlight('$if2(%title%,x)', ['if2', 'title'])).toBe('$<mark>if2</mark>(%<mark>title</mark>%,x)')
    expect(highlight('a "quote"', [])).toBe('a &quot;quote&quot;')
  })
  it('cuts a long text around the first match', () => {
    const text = `${'word '.repeat(40)}needle ${'tail '.repeat(40)}`
    const s = snippet(text, ['needle'], 60)
    expect(s.startsWith('…')).toBe(true)
    expect(s).toContain('needle')
    expect(s.length).toBeLessThanOrEqual(62)
  })
})

describe('search: where results go', () => {
  const doc = (kind: SearchDoc['kind'], key: string, extra: Partial<SearchDoc> = {}): SearchDoc => ({ id: `${kind}:${key}`, kind, key, title: key, sig: '', body: '', ...extra })

  it('loads recipes and saved formats in the playground, from either page', () => {
    expect(routeFor(doc('recipe', 'WACUP default'), 'playground')).toEqual({ type: 'action', action: { kind: 'recipe', title: 'WACUP default' } })
    expect(routeFor(doc('recipe', 'WACUP default'), 'docs')).toEqual({ type: 'href', href: '../#recipe=WACUP+default' })
    expect(routeFor(doc('saved', 's1'), 'docs')).toEqual({ type: 'href', href: '../#saved=s1' })
  })
  it('opens functions and fields in the Reference tab when listed, else the docs anchor', () => {
    expect(routeFor(doc('function', 'abbr'), 'playground')).toEqual({ type: 'action', action: { kind: 'ref', target: 'fn-abbr' } })
    expect(routeFor(doc('field', 'artist'), 'playground', () => false)).toEqual({ type: 'href', href: './extension/#field-artist' })
    expect(routeFor(doc('function', 'abbr'), 'docs')).toEqual({ type: 'href', href: '#fn-abbr' })
  })
  it('sends rules and settings to the docs page, wiki sections to GitHub', () => {
    expect(routeFor(doc('rule', 'syntax'), 'playground')).toEqual({ type: 'href', href: './extension/#rule-syntax' })
    expect(routeFor(doc('setting', 'atf.lint.rules'), 'docs')).toEqual({ type: 'href', href: '#setting-atf.lint.rules' })
    expect(routeFor(doc('wiki', 'Lint-Rules#', { page: 'Lint-Rules', anchor: '' }), 'docs')).toEqual({
      type: 'external',
      href: 'https://github.com/GhostPirateBob/atf-syntax/wiki/Lint-Rules',
    })
    expect(routeFor(doc('wiki', 'Formatting#x', { page: 'Formatting', anchor: 'install-the-extension' }), 'playground').type).toBe('external')
  })
  it('round-trips the action hash, which never clashes with share links', () => {
    for (const a of [{ kind: 'recipe', title: "Custom songticker" }, { kind: 'saved', id: 's1' }, { kind: 'ref', target: 'field-album artist' }] as const) {
      const hash = encodeAction(a)
      expect(parseAction(hash)).toEqual(a)
      expect(decodeShare(hash)).toBeUndefined()
    }
    expect(parseAction(encodeShare({ doc: '%title%', sample: 1 }))).toBeUndefined()
    expect(parseAction('#f=abc&recipe=x')).toBeUndefined()
    expect(parseAction('#ref=evil')).toBeUndefined()
    expect(parseAction('')).toBeUndefined()
  })
})

describe('search: recent searches and picks', () => {
  it('keeps the newest 8, without repeats', () => {
    let list = parseRecent(null)
    for (let i = 0; i < 12; i++) list = addRecent(list, { type: 'query', text: `q${i}` })
    expect(list).toHaveLength(RECENT_MAX)
    expect(list[0]).toEqual({ type: 'query', text: 'q11' })
    list = addRecent(list, { type: 'query', text: 'Q5' })
    expect(list.filter((r) => r.type === 'query' && r.text.toLowerCase() === 'q5')).toHaveLength(1)
    list = addRecent(list, { type: 'pick', id: 'function:abbr', title: '$abbr', kind: 'function' })
    list = addRecent(list, { type: 'pick', id: 'function:abbr', title: '$abbr', kind: 'function' })
    expect(list.filter((r) => r.type === 'pick')).toHaveLength(1)
    expect(addRecent(list, { type: 'query', text: '  ' })).toBe(list)
  })
  it('drops malformed saved entries', () => {
    expect(parseRecent('not json')).toEqual([])
    expect(parseRecent('[{"type":"query","text":"a"},{"type":"pick","id":"x"},{"type":"pick","id":"r:1","title":"t","kind":"nope"},5]')).toEqual([{ type: 'query', text: 'a' }])
  })
})

describe('saved formats', () => {
  it('saves, renames, deletes and undoes', () => {
    const store = fakeStorage()
    let list = addSaved([], ' First ', '%title%', 10, 'a')
    list = addSaved(list, '', '%artist%', 20, 'b')
    expect(list.map((s) => [s.id, s.name])).toEqual([
      ['b', 'Untitled'],
      ['a', 'First'],
    ])
    expect(writeSaved(store, list)).toBe(true)
    expect(loadSaved(store)).toEqual(list)
    list = renameSaved(list, 'a', 'Renamed')
    expect(list[1]!.name).toBe('Renamed')
    expect(renameSaved(list, 'a', '   ')).toBe(list)
    const removed = list[0]!
    list = deleteSaved(list, 'b')
    expect(list.map((s) => s.id)).toEqual(['a'])
    list = undoDelete(list, removed, 0)
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
    expect(undoDelete(list, removed, 0)).toBe(list)
  })
  it('ignores malformed storage and survives blocked storage', () => {
    const store = fakeStorage()
    store.data.set(SAVED_KEY, '[{"id":"x","name":"ok","doc":"%a%","savedAt":1},{"id":2},null]')
    expect(loadSaved(store).map((s) => s.id)).toEqual(['x'])
    store.data.set(SAVED_KEY, '{oops')
    expect(loadSaved(store)).toEqual([])
    const blocked = fakeStorage(true)
    expect(loadSaved(blocked)).toEqual([])
    expect(writeSaved(blocked, [])).toBe(false)
    expect(readLast(blocked)).toBeUndefined()
    expect(writeLast(blocked, 'x')).toBe(false)
    expect(loadSaved(undefined)).toEqual([])
  })
  it('offers the matching recipe title, or the start of the format, as the name', () => {
    expect(defaultSaveName('# c\n[%artist% - ]\n$if2(%title%,$filepart(%filename%))', RECIPES)).toBe('WACUP default')
    expect(defaultSaveName('%title%', RECIPES)).toBe('%title%')
    expect(defaultSaveName('$left(%title%,10)$right(%artist%,10)xxxxxxxx', RECIPES)).toBe('$left(%title%,10)$right(%artis…')
  })
})

describe('autosave', () => {
  const DEFAULT = '[%artist% - ]%title%'
  it('lets a share link win and leaves the autosave alone', () => {
    const store = fakeStorage()
    writeLast(store, '%album%')
    expect(initialDoc('%genre%', readLast(store), DEFAULT)).toEqual({ doc: '%genre%', restored: false })
    expect(store.data.get(LAST_KEY)).toBe('%album%')
  })
  it('restores an autosave that differs from the default', () => {
    expect(initialDoc(undefined, '%album%', DEFAULT)).toEqual({ doc: '%album%', restored: true })
  })
  it('gives first visits, and autosaves of the default or nothing, the default', () => {
    expect(initialDoc(undefined, undefined, DEFAULT)).toEqual({ doc: DEFAULT, restored: false })
    expect(initialDoc(undefined, DEFAULT, DEFAULT)).toEqual({ doc: DEFAULT, restored: false })
    expect(initialDoc(undefined, '  ', DEFAULT)).toEqual({ doc: DEFAULT, restored: false })
  })
})

describe('format button', () => {
  it('keeps every recipe equivalent at any width, and is stable', () => {
    for (const r of RECIPES) {
      for (const width of [40, 60, 90]) {
        const once = formatDoc(r.format, width)
        expect(toFormat(once.text).format, r.title).toBe(toFormat(r.format).format)
        expect(formatDoc(once.text, width).changed, r.title).toBe(false)
      }
    }
  })
  it('keeps comments, and re-wraps an already wrapped format', () => {
    const doc = '# my format\n[%artist% - ]$if2(%title%,$filepart(%filename%))[ - %album%][ - %year%][ - %genre%]'
    const r = formatDoc(doc, 40)
    expect(r.changed).toBe(true)
    expect(r.text.startsWith('# my format\n')).toBe(true)
    expect(toFormat(r.text).format).toBe(toFormat(doc).format)
    // Joined back onto one line and formatted wider: re-wrapped, still the same format.
    const rejoined = `# my format\n${r.text.split('\n').slice(1).join('')}`
    const wider = formatDoc(rejoined, 90)
    expect(wider.text).not.toBe(r.text)
    expect(toFormat(wider.text).format).toBe(toFormat(doc).format)
  })
  it('reports a syntax error that stopped it', () => {
    const r = formatDoc('$if(%artist%,a,b[%title% - ]%album% - %year% - %genre% - %comment% - %composer%', 40)
    expect(r).toMatchObject({ changed: false, blocked: true })
    expect(formatDoc('%title%', 40)).toMatchObject({ changed: false, blocked: false })
  })
})

describe('view settings: duration column', () => {
  it('defaults to on, and settings saved before it existed get it on', () => {
    expect(DEFAULT_VIEW.duration).toBe(true)
    expect(parseView('{"numbers":true}')).toMatchObject({ numbers: true, duration: true })
    expect(parseView('{"duration":false}').duration).toBe(false)
    expect(parseView('{"duration":"no"}').duration).toBe(true)
  })
})

describe('recipes', () => {
  const TICKERS = new Set(["WACUP's default song ticker", "Custom songticker"])
  it('leave %length% to the duration column, except the song tickers', () => {
    for (const r of RECIPES) if (!TICKERS.has(r.title)) expect(r.format, r.title).not.toContain('%length%')
    for (const t of TICKERS) expect(RECIPES.some((r) => r.title === t), t).toBe(true)
  })
  it('have unique formats and titles', () => {
    expect(new Set(RECIPES.map((r) => r.format)).size).toBe(RECIPES.length)
    expect(new Set(RECIPES.map((r) => r.title)).size).toBe(RECIPES.length)
  })
})

describe('duration column and song ticker recipes', () => {
  const ticker = RECIPES.find((r) => r.title === "Custom songticker")!
  const playlist = RECIPES.find((r) => r.title === 'WACUP default')!
  it('marks exactly the two ticker recipes', () => {
    expect(RECIPES.filter((r) => r.ticker).map((r) => r.title).sort()).toEqual(["Custom songticker", "WACUP's default song ticker"])
  })
  it('hides the column for a ticker recipe, shows it again for a playlist recipe, and keeps it while editing', () => {
    let active: Recipe | undefined
    active = nextActiveRecipe(active, { kind: 'recipe', recipe: ticker })
    expect(showsDuration(true, active)).toBe(false)
    active = nextActiveRecipe(active, { kind: 'edit' })
    expect(showsDuration(true, active)).toBe(false)
    active = nextActiveRecipe(active, { kind: 'recipe', recipe: playlist })
    expect(showsDuration(true, active)).toBe(true)
    active = nextActiveRecipe(nextActiveRecipe(active, { kind: 'recipe', recipe: ticker }), { kind: 'other' })
    expect(showsDuration(true, active)).toBe(true)
  })
  it('follows the setting otherwise', () => {
    expect(showsDuration(false, undefined)).toBe(false)
    expect(showsDuration(false, playlist)).toBe(false)
  })
})

describe('oneLine', () => {
  it('shows each CR and LF as one space, as WACUP draws them on a playlist row', () => {
    expect(oneLine('a\r\nb')).toBe('a  b')
    expect(oneLine('a\nb')).toBe('a b')
    expect(oneLine('a\r\n\r\nb')).toBe('a    b')
    expect(oneLine('ab')).toBe('ab')
  })
  it('matches the Taskbar thumbnail row WACUP drew for the first sample', () => {
    // gen_win10shell's original default, as the owner ran it in WACUP (the recipe has since dropped the
    // three spaces before the rating, so this checks the verbatim format WACUP's row came from).
    const format =
      "$if2(%title%,$filepart(%filename%))$if(%artist%,$crlf(),)%artist%[   $if(%rating%,$rating(%filename%),)]$if(%album%,$crlf(),)%album%[$if(%year%,' ('%year%')',)]"
    const row = oneLine(evaluate(format, fieldsFor(SAMPLE_TRACKS[0]!, { position: 1, length: 4 })).text)
    expect(row).toBe('Things I Thought Were Mine  Alfie Templeman     Happiness in Liquid Form (2020)')
  })
})
