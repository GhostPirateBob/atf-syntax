<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Copy, Menu, Download, FolderOpen, Link, Save, Settings, TextWrap } from '@lucide/vue'
import { FIELD_MAP, FUNCTION_MAP, lint, parse, splitBlocks, type Finding } from '@/core'
import { toFormat } from '@/lib/document'
import { applyDisplay, oneLine } from '@/lib/display'
import { EvalRunner, type RunOutcome } from '@/lib/runner'
import { decodeShare, encodeShare } from '@/lib/share'
import { RECIPES, nextActiveRecipe, showsDuration, type FormatSource, type Recipe } from '@/lib/recipes'
import { SAMPLE_TRACKS, durationOf, fieldsFor, newId, trackLabel, tracksFromFiles, tracksFromPlaylist, type Track } from '@/lib/tracks'
import { nulFindings } from '@/lib/nulChar'
import { exportTitle, toM3u8, type ExportRow, type PlaylistEntry } from '@/lib/m3u'
import { matchPlaylistFiles } from '@/lib/audio'
import type { Picked, PickedFile } from '@/lib/pick'
import { parseView, type ViewSettings } from '@/lib/view'
import { addSaved, browserStorage, defaultSaveName, deleteSaved, initialDoc, readLast, savedFormats, undoDelete, updateSaved, writeLast, type SavedFormat } from '@/lib/saved'
import { parseAction, type PlaygroundAction } from '@/lib/search'
import { formatDoc } from '@/lib/formatDoc'
import { NARROW, useMedia } from '@/lib/media'
import IconButton from './components/IconButton.vue'
import OmniSearch from './components/OmniSearch.vue'
import AtfEditor from './components/AtfEditor.vue'
import PartsTable from './components/PartsTable.vue'
import DiagnosticsList from './components/DiagnosticsList.vue'
import TrackList, { type Row } from './components/TrackList.vue'
import MiniPlaylist from './components/MiniPlaylist.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import SideBar from './components/SideBar.vue'

// The format a fresh visit opens with: a recipe, so it shows off more than one function.
const DEFAULT_DOC = RECIPES.find((r) => r.title === 'Long albums to initials')?.format ?? '[%artist% - ]$if2(%title%,$filepart(%filename%))'
const VIEW_KEY = 'atf-playground:view'
const MAX_PLAYLIST = 500

const cloneSamples = (): Track[] => SAMPLE_TRACKS.map((t) => ({ ...t, id: newId(), tags: { ...t.tags } }))

// ---- state -------------------------------------------------------------------------------
const shared = decodeShare(location.hash)
/** A search result picked on the docs page: `#recipe=…`, `#saved=…` or `#ref=fn-…` (never a share link). */
const startAction = shared ? undefined : parseAction(location.hash)
const store = browserStorage()
// A share link wins; otherwise the autosaved format, if it isn't the default; otherwise the default.
const start = initialDoc(shared?.doc, readLast(store), DEFAULT_DOC)
const doc = ref(start.doc)
/** The recipe the format came from, until something else is loaded (edits keep it). */
const activeRecipe = ref<Recipe>()
const setSource = (event: FormatSource) => (activeRecipe.value = nextActiveRecipe(activeRecipe.value, event))
const durationShown = computed(() => showsDuration(view.value.duration, activeRecipe.value))
const tracks = ref<Track[]>(cloneSamples())
const source = ref<'sample' | 'playlist' | 'files'>('sample')
// What the user brought, kept so a playlist and audio files can arrive one after the other.
let playlistEntries: PlaylistEntry[] = []
let fileTags: { path: string; tags: Record<string, string> }[] = []
const tagged = ref(0)
const reading = ref<{ done: number; total: number } | null>(null)
let readSeq = 0
/** The sample a fresh visit opens on (by title, so reordering the samples doesn't change it). */
const DEFAULT_SAMPLE = Math.max(0, SAMPLE_TRACKS.findIndex((t) => t.tags.title === 'Oceans'))
const selected = ref(Math.min(shared?.sample ?? DEFAULT_SAMPLE, tracks.value.length - 1))
const sidebarOpen = ref(window.innerWidth >= 1100)
/** Narrow screens: the sidebar is a drawer over the page, with a backdrop, focus kept inside. */
const isDrawer = useMedia('(max-width: 760px)')
const drawerOpen = computed(() => isDrawer.value && sidebarOpen.value)
const menuButton = ref<InstanceType<typeof IconButton>>()
/** Off for the first frames, so a sidebar opened while the page loads (a #ref= link) doesn't slide in on wide screens. */
const motion = ref(false)
const scrolled = ref(false)
const narrow = useMedia(NARROW)
const TAGLINE = 'Advanced Title Formatting for WACUP & Winamp, live'
const view = ref<ViewSettings>(loadView())
const editor = ref<InstanceType<typeof AtfEditor>>()
const toast = ref<{ text: string; action?: { label: string; run: () => void } }>()
const atfInput = ref<HTMLInputElement>()
const atfChoices = ref<{ label: string; text: string }[]>([])
const settingsOpen = ref(false)
const gear = ref<HTMLButtonElement>()

function loadView(): ViewSettings {
  try {
    return parseView(localStorage.getItem(VIEW_KEY))
  } catch {
    return parseView(null)
  }
}
watch(
  view,
  (v) => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(v))
    } catch {
      /* private window: settings just won't persist */
    }
  },
  { deep: true },
)

// ---- format, parse, lint ------------------------------------------------------------------
const format = computed(() => toFormat(doc.value).format)
const parsed = computed(() => parse(format.value))
// Plus a warning at a NUL, which the extension's linter doesn't know about (see lib/nulChar.ts).
const findings = computed<Finding[]>(() =>
  format.value ? [...nulFindings(format.value), ...lint(format.value, { dialect: view.value.dialect, result: parsed.value })].sort((a, b) => a.start - b.start) : [],
)

// ---- evaluation in a worker -------------------------------------------------------------------
const runner = new EvalRunner(1000)
const outcome = shallowRef<RunOutcome>()
let runSeq = 0
let evalTimer: ReturnType<typeof setTimeout> | undefined
watch(
  [format, tracks],
  () => {
    clearTimeout(evalTimer)
    evalTimer = setTimeout(runNow, 60)
  },
  { deep: true, immediate: true },
)
async function runNow() {
  const seq = ++runSeq
  if (!format.value) {
    outcome.value = undefined
    return
  }
  const result = await runner.run(format.value, tracks.value.map((t, i, all) => fieldsFor(t, { position: i + 1, length: all.length })))
  if (seq === runSeq) outcome.value = result
}
onBeforeUnmount(() => runner.dispose())

const rows = computed<Row[]>(() =>
  tracks.value.map((t, i) => {
    const base = { label: trackLabel(t), duration: durationShown.value ? durationOf(t) : '', cached: t.cachedTitle, unsure: false }
    const o = outcome.value
    if (!format.value) return { ...base, text: '', state: 'ok' }
    if (!o) return { ...base, text: '', state: 'pending' }
    if (o.kind === 'timeout') return { ...base, text: '', state: 'timeout' }
    if (o.kind === 'failed') return { ...base, text: '', state: 'pending' }
    const r = o.results[i]
    if (!r) return { ...base, text: '', state: 'pending' }
    if (r.freeze) return { ...base, text: '', state: 'freeze', unsure: r.unsure.length > 0 }
    if (r.tooHeavy) return { ...base, text: '', state: 'heavy' }
    if (r.error) return { ...base, text: oneLine(r.text), state: 'error' }
    return { ...base, text: oneLine(applyDisplay(r.text, view.value)), state: 'ok', unsure: r.unsure.length > 0 }
  }),
)

const current = computed(() => (outcome.value?.kind === 'ok' ? outcome.value.results[selected.value] : undefined))
const unsureFns = computed(() => {
  if (outcome.value?.kind !== 'ok') return []
  return [...new Set(outcome.value.results.flatMap((r) => r.unsure))].sort()
})
/** States that aren't about one track replace the hero's rows. */
const heroMessage = computed<{ text: string; tone: 'warn' | 'muted' } | undefined>(() => {
  if (!format.value) return { text: 'Type a title format above', tone: 'muted' }
  if (outcome.value?.kind === 'timeout') return { text: '⚠ This would freeze WACUP', tone: 'warn' }
  if (outcome.value?.kind === 'failed') return { text: "The evaluator couldn't start", tone: 'warn' }
  return undefined
})

const settingsPanel = ref<InstanceType<typeof SettingsPanel>>()
const panelEl = () => settingsPanel.value?.$el as HTMLElement | undefined

/** Closes the settings, returning focus to the gear only if it was inside the panel. */
function closeSettings() {
  const inside = !!panelEl()?.contains(document.activeElement)
  settingsOpen.value = false
  if (inside) gear.value?.focus()
}
// A press anywhere outside the panel (and not on the gear) closes it. The close waits until the
// click is over: the panel sits in the page flow, so removing it at once would move what's under
// the pointer before the click lands.
function onOutsidePointer(e: PointerEvent) {
  const t = e.target as Node
  if (panelEl()?.contains(t) || gear.value?.contains(t)) return
  const inside = !!panelEl()?.contains(document.activeElement)
  document.addEventListener(
    'pointerup',
    () =>
      setTimeout(async () => {
        if (!settingsOpen.value) return
        settingsOpen.value = false
        await nextTick()
        // Focus fell to the page (the press wasn't on something focusable): put it on the gear.
        if (inside && (!document.activeElement || document.activeElement === document.body)) gear.value?.focus()
      }),
    { once: true },
  )
}
watch(settingsOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onOutsidePointer)
  else document.removeEventListener('pointerdown', onOutsidePointer)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutsidePointer))

// ---- share link (format + sample only, never playlist data) --------------------------------------------
let hashTimer: ReturnType<typeof setTimeout> | undefined
function writeHash() {
  const isDefault = doc.value === DEFAULT_DOC && (source.value !== 'sample' || selected.value === DEFAULT_SAMPLE)
  const url = isDefault ? location.pathname + location.search : encodeShare({ doc: doc.value, sample: source.value === 'sample' ? selected.value : undefined })
  history.replaceState(null, '', url)
}
watch([doc, selected, source], () => {
  clearTimeout(hashTimer)
  hashTimer = setTimeout(writeHash, 300)
})

// ---- the sidebar as a drawer on narrow screens --------------------------------------------------
const sidebarEl = () => sidebar.value?.$el as HTMLElement | undefined
/** Closes the sidebar (drawer or column); focus goes to the menu button that reopens it. */
function closeSidebar() {
  sidebarOpen.value = false
  void nextTick(() => (menuButton.value?.$el as HTMLElement | undefined)?.focus())
}
/** Opens it from the menu button, with focus on its first tab. */
async function openSidebar() {
  sidebarOpen.value = true
  await nextTick()
  const el = sidebarEl()
  if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('header button')?.focus()
}
/** A recipe or snippet picked in the drawer closes it, so the result is in view. */
function closeDrawer() {
  if (drawerOpen.value) closeSidebar()
}
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
function onDrawerKey(e: KeyboardEvent) {
  if (!drawerOpen.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeSidebar()
  } else if (e.key === 'Tab') {
    const items = [...(sidebarEl()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null)
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || !sidebarEl()?.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !sidebarEl()?.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
}
watch(drawerOpen, async (open) => {
  // No page scrolling behind the drawer.
  document.documentElement.classList.toggle('scroll-locked', open)
  if (!open) return
  await nextTick()
  const el = sidebarEl()
  if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('header button')?.focus()
})
// ---- the sidebar as a column on wide screens ----------------------------------------------------
// Only the fixed sidebar moves (its transform); the main column is never transformed. The page's
// 340 px left padding switches with no transition: on at once when the sidebar opens (it slides
// into the space), off once it has slid away (so the content doesn't jump under a sidebar that is
// still on screen). 300 ms is the fallback if transitionend never comes.
/** Wide screens: whether the page leaves room for the sidebar. */
const spaced = ref(sidebarOpen.value)
let cancelUnspace: (() => void) | undefined
watch(sidebarOpen, (open) => {
  cancelUnspace?.()
  if (open) {
    spaced.value = true
    return
  }
  const el = sidebarEl()
  if (!el || isDrawer.value || !motion.value) {
    spaced.value = false
    return
  }
  // The slide (transform), or with less motion the fade (opacity).
  const onEnd = (e: TransitionEvent) => {
    if (e.target === el && (e.propertyName === 'transform' || e.propertyName === 'opacity')) finish()
  }
  const timer = setTimeout(() => finish(), 300)
  const stop = () => {
    clearTimeout(timer)
    el.removeEventListener('transitionend', onEnd)
    cancelUnspace = undefined
  }
  const finish = () => {
    stop()
    spaced.value = false
  }
  el.addEventListener('transitionend', onEnd)
  cancelUnspace = stop
})

const onScroll = () => (scrolled.value = window.scrollY > 4)
onMounted(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => (motion.value = true)))
  document.addEventListener('keydown', onDrawerKey)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDrawerKey)
  window.removeEventListener('scroll', onScroll)
  document.documentElement.classList.remove('scroll-locked')
})

// ---- autosave (the format only) ------------------------------------------------------------------
let autosaveTimer: ReturnType<typeof setTimeout> | undefined
function autosaveNow() {
  clearTimeout(autosaveTimer)
  autosaveTimer = undefined
  writeLast(store, doc.value)
}
watch(doc, () => {
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(autosaveNow, 800)
})
const flushAutosave = () => autosaveTimer !== undefined && autosaveNow()
addEventListener('pagehide', flushAutosave)
onBeforeUnmount(() => removeEventListener('pagehide', flushAutosave))

onMounted(() => {
  if (startAction) {
    history.replaceState(null, '', location.pathname + location.search)
    void onSearchAction(startAction)
  }
  if (start.restored && startAction?.kind !== 'recipe' && startAction?.kind !== 'saved') {
    say('Restored your last format.', { label: 'Start fresh', run: () => ((doc.value = DEFAULT_DOC), setSource({ kind: 'other' })) })
  }
})

// ---- actions -------------------------------------------------------------------------------
let toastTimer: ReturnType<typeof setTimeout> | undefined
function say(message: string, action?: { label: string; run: () => void }, ms = action ? 7000 : 3200) {
  toast.value = { text: message, action }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = undefined), ms)
}
function runToastAction() {
  const run = toast.value?.action?.run
  toast.value = undefined
  run?.()
}

async function copyFormat() {
  try {
    await navigator.clipboard.writeText(format.value)
    const freezes = findings.value.some((f) => f.severity === 'error' && (f.rule === 'replace-empty-search' || f.rule === 'negative-count'))
    say(freezes ? 'Copied as one line. Careful: this format freezes some WACUP builds.' : "Copied as one line. Paste it into WACUP's Titles preferences.")
  } catch {
    say('Copy failed: your browser blocked clipboard access.')
  }
}

async function shareLink() {
  clearTimeout(hashTimer)
  writeHash()
  if (location.hash === '') history.replaceState(null, '', encodeShare({ doc: doc.value }))
  try {
    await navigator.clipboard.writeText(location.href)
    say('Link copied. It holds the format only, never your playlist.')
  } catch {
    say('Copy failed: your browser blocked clipboard access.')
  }
}

function loadRecipe(recipe: Recipe) {
  doc.value = recipe.format
  setSource({ kind: 'recipe', recipe })
  say(`Loaded "${recipe.title}"`)
}
function loadSaved(saved: SavedFormat) {
  doc.value = saved.doc
  setSource({ kind: 'other' })
  say(`Loaded "${saved.name}"`)
}
function removeSaved(saved: SavedFormat) {
  const index = savedFormats.value.findIndex((s) => s.id === saved.id)
  updateSaved((list) => deleteSaved(list, saved.id))
  say(`Deleted "${saved.name}".`, { label: 'Undo', run: () => updateSaved((list) => undoDelete(list, saved, index)) })
}

// ---- save in this browser -------------------------------------------------------------------
const saving = ref(false)
const saveName = ref('')
const saveButton = ref<InstanceType<typeof IconButton>>()
const saveInput = ref<HTMLInputElement>()
async function openSave() {
  saveName.value = defaultSaveName(doc.value, RECIPES)
  saving.value = true
  await nextTick()
  saveInput.value?.focus()
  saveInput.value?.select()
}
function closeSave() {
  saving.value = false
  ;(saveButton.value?.$el as HTMLElement | undefined)?.focus()
}
function confirmSave() {
  const name = saveName.value.trim() || 'Untitled'
  const stored = updateSaved((list) => addSaved(list, name, doc.value))
  closeSave()
  say(stored ? `Saved "${name}". It's at the top of Recipes.` : `Kept "${name}" until you close the page: this browser won't let the page store it.`)
}

// ---- format (the extension's lossless formatter) ----------------------------------------------
function formatEditor() {
  const result = formatDoc(doc.value, editor.value?.charsPerLine() || 60)
  if (result.changed) editor.value?.rewrap(result.text)
  else if (result.blocked) say("Can't format: fix the syntax error first.")
  else say('Already formatted. Lines only break between parts, never next to a space.')
}

// ---- search results ---------------------------------------------------------------------------
const sidebar = ref<InstanceType<typeof SideBar>>()
/** Whether the sidebar's Reference tab lists a function (`fn-name`) or field (`field-name`). */
const refListed = (target: string) => (target.startsWith('fn-') ? FUNCTION_MAP.has(target.slice(3)) : FIELD_MAP.has(target.slice(6)))
async function revealInSidebar(tab: 'recipes' | 'reference', id: string): Promise<boolean> {
  sidebarOpen.value = true
  await nextTick()
  return (await sidebar.value?.reveal(tab, id)) ?? false
}
async function onSearchAction(action: PlaygroundAction) {
  if (action.kind === 'recipe') {
    const recipe = RECIPES.find((r) => r.title === action.title)
    if (!recipe) return say("That recipe isn't here any more.")
    loadRecipe(recipe)
    await revealInSidebar('recipes', `recipe:${recipe.title}`)
  } else if (action.kind === 'saved') {
    const saved = savedFormats.value.find((s) => s.id === action.id)
    if (!saved) return say("That saved format isn't in this browser.")
    loadSaved(saved)
    await revealInSidebar('recipes', `saved:${saved.id}`)
  } else if (!(refListed(action.target) && (await revealInSidebar('reference', action.target)))) {
    location.href = `./extension/#${action.target}`
  }
}

function randomRecipe() {
  const pool = RECIPES.filter((r) => r.format !== doc.value)
  const pick = pool[Math.floor(Math.random() * pool.length)]
  if (pick) loadRecipe(pick)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Tags for each file, read in the browser by MediaInfo.js. The library and its .wasm load only
 * now, on first use. A file that can't be read keeps just its name. Undefined if a newer drop
 * (or Back to samples) took over.
 */
async function readFiles(files: PickedFile[], seq: number): Promise<{ tags: Record<string, string>[]; failed: number } | undefined> {
  if (!files.length) return { tags: [], failed: 0 }
  reading.value = { done: 0, total: files.length }
  try {
    let reader: typeof import('@/lib/readTags') | undefined
    try {
      reader = await import('@/lib/readTags')
      await reader.ready()
    } catch {
      reader = undefined
      say("Couldn't load the tag reader, so only file names are shown.")
    }
    const tags: Record<string, string>[] = []
    let failed = 0
    for (const f of files) {
      if (seq !== readSeq) return undefined
      let t: Record<string, string> = { filename: f.path }
      if (reader) {
        try {
          t = await reader.readTags(f.file, f.path)
        } catch {
          failed++
        }
      }
      tags.push(t)
      if (seq === readSeq) reading.value = { done: tags.length, total: files.length }
    }
    return seq === readSeq ? { tags, failed } : undefined
  } finally {
    if (seq === readSeq) reading.value = null
  }
}

function showPlaylist(entries: PlaylistEntry[], files: { path: string; tags: Record<string, string> }[]) {
  const list = entries.slice(0, MAX_PLAYLIST)
  const match = files.length ? matchPlaylistFiles(list.map((e) => e.filename), files.map((f) => f.path)) : []
  tracks.value = tracksFromPlaylist(list, match.map((i) => files[i]?.tags))
  tagged.value = match.filter((i) => i >= 0).length
  source.value = 'playlist'
  selected.value = 0
}

/** A playlist, audio files, or both, from a drop, a picker, or a paste. */
async function openPicked({ entries, audio }: Picked) {
  const seq = ++readSeq
  reading.value = null
  if (entries && !entries.length && !audio.length) return say('No tracks found in that playlist.')
  if (!entries && !audio.length) return say('Nothing to open there. Drop audio files or an .m3u8.')
  const capNote = (n: number) => (n > MAX_PLAYLIST ? ` (the first ${MAX_PLAYLIST} of ${n})` : '')

  // A playlist on its own: merge in tags already read from files, if any match.
  if (!audio.length) {
    playlistEntries = entries!
    showPlaylist(entries!, fileTags)
    const n = entries!.length
    return say(tagged.value ? `Loaded ${plural(n, 'track')}${capNote(n)}. ${tagged.value} got tags from your files.` : `Loaded ${plural(n, 'track')}${capNote(n)}: paths and lengths only, no tags.`)
  }

  // Audio files with a playlist (dropped together, or loaded before): read only the files it names.
  const list = (entries ?? (source.value === 'playlist' ? playlistEntries : [])).slice(0, MAX_PLAYLIST)
  const match = list.length ? matchPlaylistFiles(list.map((e) => e.filename), audio.map((f) => f.path)) : []
  if (entries || match.some((i) => i >= 0)) {
    const wanted = [...new Set(match.filter((i) => i >= 0))].map((i) => audio[i]!)
    const read = await readFiles(wanted, seq)
    if (!read) return
    const fresh = wanted.map((f, i) => ({ path: f.path, tags: read.tags[i]! }))
    // More files for the playlist already shown add to the tags read before; newest first, so they win.
    fileTags = entries ? fresh : [...fresh, ...fileTags]
    playlistEntries = entries ?? playlistEntries
    showPlaylist(playlistEntries, fileTags)
    const n = playlistEntries.length
    const failed = read.failed ? ` ${plural(read.failed, 'file')} couldn't be read.` : ''
    return say(tagged.value ? `Loaded ${plural(n, 'track')}${capNote(n)}. ${tagged.value} got tags from your files.${failed}` : `Loaded ${plural(n, 'track')}${capNote(n)}. None of the files matched it, so there are no tags.`)
  }

  // Audio files on their own, in folder and file-name order.
  const files = [...audio].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })).slice(0, MAX_PLAYLIST)
  const read = await readFiles(files, seq)
  if (!read) return
  fileTags = files.map((f, i) => ({ path: f.path, tags: read.tags[i]! }))
  playlistEntries = []
  tracks.value = tracksFromFiles(read.tags)
  tagged.value = 0
  source.value = 'files'
  selected.value = 0
  const failed = read.failed ? ` ${plural(read.failed, 'file')} couldn't be read.` : ''
  say(`Read tags from ${plural(files.length, 'file')}${capNote(audio.length)}.${failed}`)
}
function useSamples() {
  readSeq++
  reading.value = null
  playlistEntries = []
  fileTags = []
  tagged.value = 0
  tracks.value = cloneSamples()
  source.value = 'sample'
  selected.value = DEFAULT_SAMPLE
}
function setTag(index: number, key: string, value: string) {
  const t = tracks.value[index]
  if (t) t.tags[key] = value
}

function openAtf() {
  atfInput.value?.click()
}
async function onAtfPicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (atfInput.value) atfInput.value.value = ''
  if (!file) return
  const lines = (await file.text()).replace(/\r\n?/g, '\n').split('\n')
  const blocks = splitBlocks(lines).map((b, i) => {
    const first = b.segments[0]?.line ?? 0
    const last = b.segments[b.segments.length - 1]?.line ?? first
    return { label: `Format ${i + 1}`, text: lines.slice(first, last + 1).join('\n') }
  })
  if (!blocks.length) return say('That file has no formats in it.')
  atfChoices.value = blocks.length > 1 ? blocks : []
  doc.value = blocks[0]!.text
  setSource({ kind: 'other' })
  say(blocks.length > 1 ? `${blocks.length} formats in ${file.name}: pick one above.` : `Opened ${file.name}`)
}
function saveAtf() {
  const blob = new Blob([doc.value.endsWith('\n') ? doc.value : doc.value + '\n'], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'title-format.atf'
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * The playlist as `winamp.m3u8`, with the rendered titles in its `#EXTINF` lines, so it can stand
 * in for WACUP's own until WACUP re-reads each track's tags. Untagged tracks get a confirm first.
 */
function saveM3u8(confirmed = false) {
  if (source.value !== 'playlist') return
  const untagged = tracks.value.length - tagged.value
  if (untagged > 0 && !confirmed) {
    const one = untagged === 1
    return say(`${plural(untagged, 'track')} ${one ? 'has' : 'have'} no tags, so ${one ? 'its title is a file name' : 'their titles are file names'}. Drop ${one ? 'its audio file' : 'their audio files'} first for real titles.`, {
      label: 'Save anyway',
      run: () => saveM3u8(true),
    })
  }
  const list: ExportRow[] = tracks.value.map((t, i) => {
    const r = rows.value[i]
    return { filename: t.path ?? t.tags.filename ?? '', lengthSeconds: t.tags.length_seconds, text: r?.text ?? '', state: r?.state ?? 'pending', cachedTitle: t.cachedTitle }
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([toM3u8(list)], { type: 'audio/x-mpegurl' }))
  a.download = 'winamp.m3u8'
  a.click()
  URL.revokeObjectURL(a.href)
  const reasons = list.map((r) => exportTitle(r).reason)
  const blocked = reasons.filter((r) => r === 'blocked').length
  const empty = reasons.filter((r) => r === 'empty').length
  const keep = (n: number) => (n === 1 ? 'it keeps its' : 'they keep their')
  const unsure = rows.value.some((r) => r.unsure && (r.state === 'ok' || r.state === 'error'))
  const notes = [
    blocked ? `${plural(blocked, 'track')} had no title to write (it would freeze WACUP, is too heavy, or is still rendering), so ${keep(blocked)} playlist title or file name.` : '',
    empty ? `${plural(empty, 'track')} rendered as an empty title, so ${keep(empty)} playlist title or file name.` : '',
    unsure ? "Some titles contain ? where the playground couldn't confirm WACUP's output." : '',
  ].filter(Boolean)
  say(['Saved winamp.m3u8. Close WACUP before you swap it in.', ...notes].join(' '), undefined, notes.length ? 9000 : 4500)
}

function pickRange(range: { start: number; end: number }) {
  editor.value?.select(range.start, range.end)
}
function hoverRange(range: { start: number; end: number } | null) {
  editor.value?.focusRange(range)
}
</script>

<template>
  <div class="app" :class="{ 'with-sidebar': spaced, still: !motion }">
    <SideBar
      ref="sidebar"
      class="side"
      :class="{ open: sidebarOpen }"
      :role="isDrawer ? 'dialog' : undefined"
      :aria-modal="isDrawer ? 'true' : undefined"
      aria-label="Recipes and reference"
      @insert="editor?.insert($event), closeDrawer()"
      @load="loadRecipe($event), closeDrawer()"
      @load-saved="loadSaved($event), closeDrawer()"
      @delete="removeSaved"
      @close="closeSidebar"
    />
    <div v-if="isDrawer" class="drawer-backdrop" :class="{ on: drawerOpen }" aria-hidden="true" @click="closeSidebar" />

    <div class="main">
      <header class="top" :class="{ scrolled }">
        <div class="top-left">
          <IconButton
            v-if="!sidebarOpen || isDrawer"
            ref="menuButton"
            :icon="Menu"
            label="Recipes & reference"
            collapse="always"
            :aria-expanded="sidebarOpen"
            @click="sidebarOpen ? closeSidebar() : openSidebar()"
          />
          <h1 class="brand-h">
            <a class="brand" href="./" :aria-label="`atf playground: ${TAGLINE}`" :title="narrow ? TAGLINE : undefined">
              <span class="title">atf<span class="title-rest"> playground</span></span>
              <span class="tagline">{{ TAGLINE }}</span>
            </a>
          </h1>
        </div>
        <OmniSearch class="top-search" page="playground" :ref-listed="refListed" @action="onSearchAction" />
        <div class="top-right">
          <IconButton :icon="FolderOpen" label="Open .atf" collapse="header" @click="openAtf" />
          <IconButton :icon="Download" label="Save .atf" collapse="header" @click="saveAtf" />
          <IconButton :icon="Link" label="Share link" collapse="header" @click="shareLink" />
          <ThemeToggle />
        </div>
        <input ref="atfInput" type="file" accept=".atf,.txt" hidden @change="onAtfPicked" />
      </header>

      <nav v-if="atfChoices.length" class="choices">
        <button v-for="c in atfChoices" :key="c.label" :class="{ active: c.text === doc }" @click="(doc = c.text), setSource({ kind: 'other' })">{{ c.label }}</button>
        <button class="dismiss" aria-label="Close format picker" @click="atfChoices = []">✕</button>
      </nav>

      <main class="center">

        <div class="box-wrap" @keydown.esc="settingsOpen && closeSettings()">
          <button
            ref="gear"
            class="gear"
            aria-label="Settings"
            title="Settings"
            :aria-expanded="settingsOpen"
            aria-controls="settings-panel"
            @click="settingsOpen = !settingsOpen"
          >
            <Settings :size="20" aria-hidden="true" />
          </button>
          <div class="box">
            <AtfEditor ref="editor" v-model:doc="doc" :findings="findings" class="box-editor" @format="formatEditor" />
            <div class="box-actions">
              <IconButton :icon="Copy" label="Copy" class="copy primary" title="Copy the format as one line, ready for WACUP" @click="copyFormat" />
              <IconButton
                ref="saveButton"
                :icon="Save"
                label="Save in this browser"
                collapse="always"
                class="save"
                aria-haspopup="dialog"
                :aria-expanded="saving"
                @click="saving ? closeSave() : openSave()"
              />
            </div>
          </div>
          <form v-if="saving" class="save-pop" role="dialog" aria-label="Save in this browser" @submit.prevent="confirmSave" @keydown.esc.stop.prevent="closeSave">
            <label for="save-name">Name</label>
            <input id="save-name" ref="saveInput" v-model="saveName" type="text" maxlength="80" />
            <button type="submit" class="primary">Save</button>
            <button type="button" @click="closeSave">Cancel</button>
            <p class="muted">Kept in this browser only. Find it under Recipes.</p>
          </form>
          <button class="random" @click="randomRecipe">random recipe</button>
          <button class="format" aria-label="Format (wrap at top-level boundaries)" title="Format: wrap at top-level boundaries (Shift+Alt+F)" @click="formatEditor">
            <TextWrap :size="16" aria-hidden="true" class="format-icon" />
            <span class="format-text">format</span>
          </button>
        </div>
        <Transition name="strip">
          <SettingsPanel v-if="settingsOpen" ref="settingsPanel" v-model="view" @close="closeSettings" />
        </Transition>

        <section class="hero">
          <MiniPlaylist :rows="rows" :selected="selected" :view="view" :message="heroMessage" @select="selected = $event" />
          <p v-if="format && outcome?.kind === 'timeout'" class="sub">It didn't finish within a second, so the playground stopped it. In WACUP you'd have to end the task.</p>
          <p v-else-if="format && outcome?.kind === 'failed'" class="sub">{{ outcome.message }}</p>
          <p v-else-if="current?.freeze" class="sub">
            <a href="#" @click.prevent="pickRange(current.freeze)">${{ current.freeze.fn }}()</a> never finishes on WACUP 1.99.57.25464.
          </p>
          <p v-else-if="current?.tooHeavy" class="sub">This format builds more text than the playground will work through (tens of millions of characters along the way). WACUP may still handle it.</p>
          <p v-else-if="current?.error" class="sub error-note">There's a syntax error, so WACUP shows an error message in place of the broken part (the whole title, if it's at the top level). Details below.</p>
          <p v-if="activeRecipe?.ticker && view.duration" class="dialect-note">Song ticker format: no duration column, since it ends in <code>%length%</code>.</p>
          <p v-if="view.dialect === 'winamp'" class="dialect-note">Preview shows WACUP 1.99.57. Winamp 5 differs: for example <code>$if</code> tests whether a field resolved.</p>
        </section>

        <PartsTable :format="format" :parsed="parsed" @hover="hoverRange" @pick="pickRange" />
        <DiagnosticsList v-if="format" :findings="findings" @pick="pickRange" />
        <p v-if="unsureFns.length" class="unsure-note">
          <strong>?</strong> marks output from <code v-for="f in unsureFns" :key="f">${{ f }}()</code>, which hasn't been checked against WACUP's own evaluator yet.
        </p>
      </main>

      <section class="lower">
        <TrackList
          :tracks="tracks"
          :rows="rows"
          :selected="selected"
          :view="view"
          :source="source"
          :tagged="tagged"
          :reading="reading"
          @select="selected = $event"
          @set-tag="setTag"
          @open="openPicked"
          @samples="useSamples"
          @export="saveM3u8()"
        />
      </section>

      <footer>
        <span>The checking here is the same as the <a href="https://marketplace.visualstudio.com/items?itemName=gpb.atf-syntax" target="_blank" rel="noopener">ATF extension for VS Code</a>.</span> <span><a href="./extension/">Extension docs</a></span> <span><a href="https://github.com/GhostPirateBob/atf-syntax/wiki" target="_blank" rel="noopener">Wiki</a></span> <span><a href="https://github.com/GhostPirateBob/atf-syntax" target="_blank" rel="noopener">Source on GitHub</a></span> <span><a href="./third-party-notices.txt">Third-party notices</a></span> <span>Not affiliated with or endorsed by WACUP or Winamp.</span>
      </footer>
    </div>

    <div class="toast-region" role="status">
      <Transition name="toast">
        <div v-if="toast" class="toast">
          <span>{{ toast.text }}</span>
          <button v-if="toast.action" class="toast-action" @click="runToastAction">{{ toast.action.label }}</button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 1fr;
  min-height: 100vh;
}
.side {
  position: fixed;
  inset: 0 auto 0 0;
  width: 340px;
  z-index: 16;
  contain: layout paint;
  will-change: transform;
  /* Closed: off to the left (with less motion: faded out), then hidden so it can't take focus. */
  transform: translate3d(calc(-100% * var(--motion)), 0, 0);
  opacity: var(--motion);
  visibility: hidden;
  /* 250 ms easeOutQuad both ways; hidden once it has slid away. */
  transition:
    transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 0.12s ease-out,
    visibility 0s linear 0.25s;
}
.side.open {
  transform: translate3d(0, 0, 0);
  opacity: 1;
  visibility: visible;
  transition:
    transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 0.12s ease-out,
    visibility 0s;
}
/* Nothing slides while the page loads (a #ref= link can open the sidebar then). */
.app.still .side,
.app.still .drawer-backdrop {
  transition: none;
}
.main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
/* Wide screens: the sidebar sits in a 340 px gap the page leaves, switched with no transition (see
   `spaced`); only the sidebar itself moves. */
@media (min-width: 761px) {
  .app.with-sidebar {
    padding-left: 340px;
  }
}
/* One row, stuck to the top: title, search in the middle, file actions. */
.top {
  position: sticky;
  top: 0;
  z-index: 15;
  display: grid;
  /* The side groups keep their buttons on one line; the search takes what's left, centred. */
  grid-template-columns: minmax(max-content, 1fr) minmax(160px, 440px) minmax(max-content, 1fr);
  align-items: center;
  gap: 10px;
  min-height: var(--header-h);
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--sidebar);
}
.top.scrolled {
  box-shadow: 0 2px 14px var(--shadow);
}
.top-left,
.top-right {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* The title with the tagline beside it, on two small lines. */
.brand-h {
  margin: 0 0 0 18px;
  font-size: 1rem;
  font-weight: normal;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  line-height: 1.15;
  text-decoration: none;
}
.brand:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 3px;
  border-radius: 2px;
}
.brand:hover .title {
  text-decoration: underline;
}
.top-right {
  justify-content: flex-end;
}
.choices {
  display: flex;
  gap: 6px;
  padding: 6px 14px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.choices .active {
  border-color: var(--gold);
  color: var(--bright);
}
.center {
  padding: 0 20px 10px;
  text-align: center;
}
.title {
  font-family: var(--mono);
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--blue);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.tagline {
  max-width: 11rem;
  font-size: 0.65rem;
  color: var(--muted);
  white-space: normal;
}
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 19;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    visibility 0s linear 0.25s;
}
.drawer-backdrop.on {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    visibility 0s;
}
.hero {
  max-width: 960px;
  margin: 10px auto 18px;
}
.dialect-note {
  margin: 8px 0 0;
  font-size: 0.82rem;
  color: var(--muted);
}
.error-note {
  color: var(--error);
}
.sub {
  margin: 10px 0 0;
  font-size: 1.05rem;
}
.sub a {
  color: var(--text);
}
.box-wrap {
  position: relative;
  max-width: 960px;
  /* The tabs hang in the padding; the margins keep them clear of the header and what follows. */
  margin: 52px auto 36px;
  padding: 30px 0 24px;
}
/* Tabs on the box: the gear above its top-right corner, random recipe and format below it. */
.gear,
.random,
.format {
  position: absolute;
  isolation: isolate;
  background: var(--tab-bg);
  border-color: var(--teal);
  color: var(--tab-fg);
  text-align: center;
  align-items: center;
}
/* The hover tint is an overlay under the label that fades in (opacity only): 15 % teal over the
   tab, the same colour as mixing it in. */
.gear::before,
.random::before,
.format::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: color-mix(in srgb, var(--teal) 15%, transparent);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}
.gear:hover::before,
.gear:focus-visible::before,
.random:hover::before,
.random:focus-visible::before,
.format:hover::before,
.format:focus-visible::before {
  opacity: 1;
}
.gear:hover,
.gear:focus-visible,
.random:hover,
.random:focus-visible,
.format:hover,
.format:focus-visible {
  color: var(--tab-fg);
}
/* Each tab leaves out the border on the side it shares with the box, so it looks attached. */
.gear {
  right: 18px;
  top: 0;
  height: 30px;
  width: 38px;
  padding: 0;
  display: grid;
  place-items: center;
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
}
.gear svg {
  transition: transform calc(0.2s * var(--motion));
}
.gear[aria-expanded='true'] svg {
  transform: rotate(45deg);
}
.gear:focus-visible,
.random:focus-visible,
.format:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 1px;
}
.random,
.format {
  bottom: 0;
  height: 24px;
  padding: 0 10px;
  font-family: var(--mono);
  font-size: 0.82rem;
  border-top: 0;
  border-radius: 0 0 4px 4px;
  text-decoration: underline;
}
.random {
  left: 18px;
}
.format {
  right: 18px;
  display: inline-flex;
  gap: 5px;
}
.format-icon {
  display: none;
}
.box {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 3px solid var(--teal);
  border-radius: 6px;
  background: var(--bg);
  box-shadow: 0 0 18px var(--glow);
  padding-right: 12px;
  text-align: left;
}
.box:focus-within {
  box-shadow: 0 0 24px rgba(42, 161, 152, 0.45);
}
.box-editor {
  flex: 1;
  min-width: 0;
}
.box-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.copy {
  font-weight: 600;
}
.save-pop {
  position: absolute;
  right: 12px;
  top: calc(100% - 22px);
  z-index: 30;
  /* Opens out of the save button, above its right end. */
  transform-origin: top right;
  transition:
    opacity 0.14s ease-out,
    transform 0.14s ease-out;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  width: min(380px, calc(100vw - 32px));
  padding: 10px 12px;
  background: var(--sidebar);
  border: 1px solid var(--teal);
  border-radius: 6px;
  box-shadow: 0 8px 24px var(--shadow);
  text-align: left;
  font-size: 0.88rem;
}
@starting-style {
  .save-pop {
    opacity: 0;
    transform: translate3d(0, calc(-6px * var(--motion)), 0) scale(calc(1 - 0.03 * var(--motion)));
  }
}
.save-pop input {
  flex: 1 1 140px;
  min-width: 0;
}
.save-pop p {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.78rem;
}
.save-pop button:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 1px;
}
.unsure-note {
  max-width: 820px;
  margin: 10px auto 0;
  font-size: 0.8rem;
  color: var(--muted);
}
.unsure-note code {
  margin: 0 3px;
}
.lower {
  display: grid;
  /* minmax(0, ...): a fixed playlist width inside must not widen the page on a phone. */
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  max-width: 1100px;
  width: 100%;
  margin: 24px auto 0;
  padding: 0 20px;
}
footer {
  display: block;
  text-align: center;
  padding: 26px 20px 30px;
  font-size: 0.78rem;
  line-height: 1.8;
  color: var(--muted);
}
/* One line of fine print that wraps like text; copying it gives one line too. */
footer > span {
  margin-inline: 0.6em;
}
footer a {
  color: var(--muted);
  text-decoration: none;
}
footer a:hover,
footer a:focus-visible {
  color: var(--text);
  text-decoration: underline;
}
footer a:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 2px;
  border-radius: 2px;
}
@media (max-width: 760px) {
  /* The drawer: slides in from the left over a dimmed page (the same slide as the wide sidebar). */
  .side {
    width: min(340px, 88vw);
    z-index: 20;
    box-shadow: 4px 0 24px var(--shadow);
  }
  .top {
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 6px;
  }
  .top-search {
    justify-self: end;
  }
}
/* The settings strip under the gear: a short fade and drop, from the gear (top right). */
.strip-enter-active,
.strip-leave-active {
  transform-origin: top right;
  transition:
    opacity 0.18s ease-out,
    transform 0.18s ease-out;
}
.strip-enter-from,
.strip-leave-to {
  opacity: 0;
  transform: translate3d(0, calc(-8px * var(--motion)), 0);
}
@media (max-width: 640px) {
  .top {
    padding: 6px 10px;
  }
  .title {
    font-size: 1.15rem;
  }
  /* "atf" on phones; the tagline moves to the tooltip, and screen readers hear both. */
  .tagline {
    display: none;
  }
  .title-rest {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .box-wrap {
    margin: 36px auto 28px;
  }
  /* Copy and save stack, so the editor keeps its width. */
  .box {
    padding-right: 8px;
  }
  .box-actions {
    flex-direction: column;
  }
  .format-icon {
    display: block;
  }
  .format-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
}
</style>
