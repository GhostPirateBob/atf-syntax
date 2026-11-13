<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef, watch } from 'vue'
import { BookOpen, BookText, Copy, Menu, Download, FolderOpen, GitFork, Link, RotateCcw, Save, Settings, Shuffle, TextWrap } from '@lucide/vue'
import { FIELD_MAP, FUNCTION_MAP, lint, parse, splitBlocks, type Finding } from '@/core'
import { toFormat } from '@/lib/document'
import { applyDisplay, oneLine } from '@/lib/display'
import { EvalRunner, type RunOutcome } from '@/lib/runner'
import type { EvalResult } from '@core/evaluate'
import { previewWindow } from '@/lib/playlistWindow'
import { whenIdle, yieldToMain } from '@/lib/timing'
import { useScrolled } from '@/lib/scrolled'
import type { ShareState } from '@/lib/share'
import { loadShare } from '@/lib/shareLink'
import { RECIPES, showsDuration, type Recipe } from '@/lib/recipes'
import type { Origin } from '@/lib/docHistory'
import { SAMPLE_TRACKS, fieldsFor, lengthOf, newId, trackLabel, tracksFromFiles, tracksFromPlaylist, type Track } from '@/lib/tracks'
import { nulFindings } from '@/lib/nulChar'
import { clearTracks, readTracks, writeTracks } from '@/lib/savedTracks'
import { exportTitle, toM3u8, type ExportRow, type PlaylistEntry } from '@/lib/m3u'
import { matchPlaylistFiles } from '@/lib/audio'
import type { Picked, PickedFile } from '@/lib/pick'
import { parseView, type ViewSettings } from '@/lib/view'
import { addSaved, browserStorage, defaultSaveName, deleteSaved, initialDoc, readLast, savedFormats, undoDelete, updateSaved, writeLast, type SavedFormat } from '@/lib/saved'
import { parseAction, type PlaygroundAction } from '@/lib/searchAction'
import { formatDoc } from '@/lib/formatDoc'
import { useMedia } from '@/lib/media'
import { prefetchTooltip, vTip } from '@/lib/tooltip'
import IconButton from './components/IconButton.vue'
import OmniSearch from './components/OmniSearch.vue'
import AtfEditor from './components/AtfEditor.vue'
import PartsTable from './components/PartsTable.vue'
import DiagnosticsList from './components/DiagnosticsList.vue'
import TrackList, { type Row } from './components/TrackList.vue'
import MiniPlaylist from './components/MiniPlaylist.vue'
import type SettingsPanelType from './components/SettingsPanel.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import SideBar from './components/SideBar.vue'

// Not needed for the first render: the settings strip (on the gear) and the song ticker (ticker
// recipes only) load on their own, fetched once the page is idle so the first open is instant.
const SettingsPanel = defineAsyncComponent(() => import('./components/SettingsPanel.vue'))
const SongTicker = defineAsyncComponent(() => import('./components/SongTicker.vue'))

// The format a fresh visit opens with: a recipe, so it shows off more than one function.
const DEFAULT_RECIPE = RECIPES.find((r) => r.title === 'Long albums to initials')
const DEFAULT_DOC = DEFAULT_RECIPE?.format ?? '[%artist% - ]$if2(%title%,$filepart(%filename%))'
const recipeOrigin = (r: Recipe): Origin => ({ label: r.title, text: r.format, recipe: r.title })
/** What Reset goes back to when the format's own origin isn't known (an autosave, typing from scratch). */
const DEFAULT_ORIGIN: Origin = DEFAULT_RECIPE ? recipeOrigin(DEFAULT_RECIPE) : { label: 'the default format', text: DEFAULT_DOC }
const VIEW_KEY = 'atf-playground:view'
/** Tracks kept from a playlist or a set of files: the list is virtualised and evaluated in chunks, so this is about memory, not speed. */
const MAX_PLAYLIST = 5000

const cloneSamples = (): Track[] => SAMPLE_TRACKS.map((t) => ({ ...t, id: newId(), tags: { ...t.tags } }))

/** The share link the page opened on, decoded by main.ts before the first render. */
const props = defineProps<{ shared?: ShareState }>()

// ---- state -------------------------------------------------------------------------------
const shared = props.shared
/** A search result picked on the docs page: `#recipe=…`, `#saved=…` or `#ref=fn-…` (never a share link). */
const startAction = shared ? undefined : parseAction(location.hash)
const store = browserStorage()
// A share link wins; otherwise the autosaved format, if it isn't the default; otherwise the default.
const start = initialDoc(shared?.doc, readLast(store), DEFAULT_DOC)
const doc = ref(start.doc)
/**
 * Where the format came from (see lib/docHistory.ts). The editor owns it: loading something sets
 * it, edits keep it, undo and redo bring back the one before.
 */
const origin = shallowRef<Origin | null>(shared ? { label: 'the shared format', text: shared.doc } : null)
/** The recipe the format came from, until something else is loaded (edits keep it). */
const activeRecipe = computed(() => RECIPES.find((r) => r.title === origin.value?.recipe))
const durationShown = computed(() => showsDuration(view.value.duration, activeRecipe.value))
/** A song ticker recipe is the origin: the preview is a scrolling one-line ticker (undo and redo follow it). */
const tickerMode = computed(() => !!activeRecipe.value?.ticker)
/** The last playlist or files loaded, remembered in this browser; not when a share link picks a sample. */
const remembered = shared?.sample !== undefined ? null : readTracks(store)
const tracks = ref<Track[]>(remembered?.tracks ?? cloneSamples())
const source = ref<'sample' | 'playlist' | 'files'>(remembered?.source ?? 'sample')
// What the user brought, kept so a playlist and audio files can arrive one after the other. A
// remembered playlist is rebuilt into both, so files dropped later merge with it as before.
let playlistEntries: PlaylistEntry[] =
  remembered?.source === 'playlist'
    ? remembered.tracks.map((t) => ({ filename: t.path ?? t.tags.filename ?? '', lengthSeconds: t.tags.length_seconds ? Number(t.tags.length_seconds) : undefined, cachedTitle: t.cachedTitle }))
    : []
let fileTags: { path: string; tags: Record<string, string> }[] =
  remembered?.source === 'files' ? remembered.tracks.map((t) => ({ path: t.tags.filename ?? '', tags: t.tags })) : []
const tagged = ref(remembered?.tagged ?? 0)
const reading = ref<{ done: number; total: number } | null>(null)
let readSeq = 0
/** The sample a fresh visit opens on (by title, so reordering the samples doesn't change it). */
const DEFAULT_SAMPLE = Math.max(0, SAMPLE_TRACKS.findIndex((t) => t.tags.title === 'Oceans'))
const selected = ref(remembered ? remembered.selected : Math.min(shared?.sample ?? DEFAULT_SAMPLE, tracks.value.length - 1))
// matchMedia, not innerWidth: reading innerWidth during setup forces a layout of the page.
const sidebarOpen = ref(window.matchMedia('(min-width: 1100px)').matches)
/** Narrow screens: the sidebar is a drawer over the page, with a backdrop, focus kept inside. */
const isDrawer = useMedia('(max-width: 760px)')
const drawerOpen = computed(() => isDrawer.value && sidebarOpen.value)
const menuButton = ref<InstanceType<typeof IconButton>>()
/** Off for the first frames, so a sidebar opened while the page loads (a #ref= link) doesn't slide in on wide screens. */
const motion = ref(false)
const scrolled = useScrolled()
/** Phones: the footer's doc links are icons (named by aria-label and the tooltip). */
const narrow = useMedia('(max-width: 640px)')
/** The brand link's tooltip (the tagline used to show beside the title). */
const TAGLINE = 'atf-playground - Advanced Title Formatting for WACUP & Winamp, live'
const view = ref<ViewSettings>(loadView())
const editor = ref<InstanceType<typeof AtfEditor>>()
const toast = ref<{ text: string; action?: { label: string; run: () => void } }>()
const atfInput = ref<HTMLInputElement>()
const atfChoices = ref<{ label: string; text: string; origin: Origin }[]>([])
const settingsOpen = ref(false)
const gear = ref<HTMLButtonElement>()

function loadView(): ViewSettings {
  try {
    return parseView(localStorage.getItem(VIEW_KEY))
  } catch {
    return parseView(null)
  }
}
// Saved when the page is idle (a slider drag changes it many times a second).
let cancelViewSave: (() => void) | undefined
watch(
  view,
  (v) => {
    cancelViewSave?.()
    cancelViewSave = whenIdle(() => {
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(v))
      } catch {
        /* private window: settings just won't persist */
      }
    })
  },
  { deep: true },
)

// ---- format, parse, lint ------------------------------------------------------------------
const format = computed(() => toFormat(doc.value).format)
/**
 * The format the parse, lint, parts table and problems list follow: `format`, one yield later, so
 * a keystroke or a recipe pick paints the editor (and starts the preview) before that work runs.
 */
const lintFormat = shallowRef(format.value)
let lintSeq = 0
watch(format, async (f) => {
  const seq = ++lintSeq
  await yieldToMain()
  if (seq === lintSeq) lintFormat.value = f
})
const parsed = computed(() => parse(lintFormat.value))
// Both dialects, for the summary of what each will accept; the list and squiggles use the setting's.
const lintIn = (dialect: ViewSettings['dialect']) => (lintFormat.value ? lint(lintFormat.value, { dialect, result: parsed.value }) : [])
const wacupFindings = computed(() => lintIn('wacup'))
const winampFindings = computed(() => lintIn('winamp'))
// Plus a warning at a NUL, which the extension's linter doesn't know about (see lib/nulChar.ts).
const findings = computed<Finding[]>(() =>
  lintFormat.value ? [...nulFindings(lintFormat.value), ...(view.value.dialect === 'winamp' ? winampFindings : wacupFindings).value].sort((a, b) => a.start - b.start) : [],
)
/**
 * The editor's squiggles: the findings once they're for the format in the editor. Until then the
 * same array as before, so nothing is dispatched and CodeMirror keeps mapping the old marks through
 * the edit.
 */
let editorShown: Finding[] = []
const editorFindings = computed(() => (lintFormat.value === format.value ? (editorShown = findings.value) : editorShown))
const errorsOnly = (list: Finding[]) => list.filter((f) => f.severity === 'error')
const acceptance = computed(() => ({ wacup: errorsOnly(wacupFindings.value), winamp: errorsOnly(winampFindings.value) }))

// ---- evaluation in a worker -------------------------------------------------------------------
// The worker keeps the playlist (sent when it changes); typing sends only the format. Results stream
// back in chunks, the selected track and those on screen first, and are applied once per frame.
// Until a track's new result arrives, its row keeps the last one, so nothing blanks while typing.
const runner = new EvalRunner(1000)
/** The final state of the newest run that finished (undefined while the first one runs). */
const outcome = shallowRef<RunOutcome>()
/** The latest result for each track: from the current run where it has arrived, else from the one before. */
const results = shallowRef<(EvalResult | undefined)[]>([])
/** Whether a run is still streaming in. */
const running = ref(false)
/** Rows in the track list's view, evaluated first (from TrackList). */
const listView = shallowRef<number[]>([])
let runSeq = 0
let evalTimer: ReturnType<typeof setTimeout> | undefined
/** What the evaluator sees for each track; rebuilt only when the tracks change, not on every keystroke. */
const trackFields = computed(() => tracks.value.map((t, i, all) => fieldsFor(t, { position: i + 1, length: all.length })))
watch(trackFields, (fields) => runner.setTracks(fields), { immediate: true })
// A different playlist: the old results belong to other tracks.
watch(
  () => tracks.value,
  () => (results.value = []),
)
watch(
  [format, trackFields],
  () => {
    clearTimeout(evalTimer)
    evalTimer = setTimeout(runNow, 60)
  },
  { immediate: true },
)
/** Chunks waiting to be shown: one per frame, so no frame renders a whole playlist's results. */
let incoming: [number, EvalResult][][] = []
let frame = 0
/** The finished run's outcome, applied once its last chunk is shown. */
let finished: RunOutcome | undefined
function applyNext() {
  frame = 0
  const chunk = incoming.shift()
  if (chunk) {
    const list = results.value
    for (const [i, r] of chunk) list[i] = r
    triggerRef(results)
  }
  if (incoming.length) frame = requestAnimationFrame(applyNext)
  else if (finished) {
    running.value = false
    outcome.value = finished
    finished = undefined
  }
}
async function runNow() {
  const seq = ++runSeq
  if (!format.value) {
    outcome.value = undefined
    running.value = false
    return
  }
  const n = tracks.value.length
  const first = [selected.value, ...(n ? previewWindow(n, selected.value).map((s) => s.index) : []), ...listView.value]
  running.value = true
  incoming = []
  finished = undefined
  // After a time-out or a failure the old results are unreliable: start from pending rows.
  if (outcome.value?.kind === 'timeout' || outcome.value?.kind === 'failed') {
    outcome.value = undefined
    results.value = []
  }
  const result = await runner.run(format.value, {
    first,
    onChunk: (items) => {
      if (seq !== runSeq) return
      incoming.push(items)
      if (!frame) frame = requestAnimationFrame(applyNext)
    },
  })
  if (seq !== runSeq || result.kind === 'superseded') return
  finished = result
  if (!frame) applyNext()
}
onBeforeUnmount(() => runner.dispose())

/** Each track's label, length and cached title: rebuilt when the tracks change, not per result. */
const rowBase = computed(() => tracks.value.map((t) => ({ label: trackLabel(t), duration: durationShown.value ? lengthOf(t) : '', cached: t.cachedTitle })))
/** Displayed text per result, so a chunk only works out the rows it brings. New when the display settings change. */
const shownText = computed(() => {
  const opts = { trimLeading: view.value.trimLeading, underscoresToSpaces: view.value.underscoresToSpaces, pct20ToSpaces: view.value.pct20ToSpaces }
  const cache = new WeakMap<EvalResult, string>()
  return (r: EvalResult) => {
    let t = cache.get(r)
    if (t === undefined) cache.set(r, (t = r.error ? oneLine(r.text) : oneLine(applyDisplay(r.text, opts))))
    return t
  }
})
const rows = computed<Row[]>(() => {
  const o = outcome.value
  const list = results.value
  const text = shownText.value
  return rowBase.value.map((base, i): Row => {
    if (!format.value) return { ...base, text: '', state: 'ok', unsure: false }
    if (o?.kind === 'timeout') return { ...base, text: '', state: 'timeout', unsure: false }
    const r = list[i]
    if (!r) return { ...base, text: '', state: 'pending', unsure: false }
    if (r.freeze) return { ...base, text: '', state: 'freeze', unsure: r.unsure.length > 0 }
    if (r.tooHeavy) return { ...base, text: '', state: 'heavy', unsure: false }
    if (r.error) return { ...base, text: text(r), state: 'error', unsure: false }
    return { ...base, text: text(r), state: 'ok', unsure: r.unsure.length > 0 }
  })
})

const current = computed(() => (outcome.value?.kind === 'timeout' ? undefined : results.value[selected.value]))
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

const settingsPanel = ref<InstanceType<typeof SettingsPanelType>>()
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
/** Set by Reset: while the format and track are still what it left, the address stays the clean page URL. */
let cleanUrl: { doc: string; selected: number; source: string } | undefined
/** Bumped by each address write, so one still waiting for lz-string can tell it was overtaken. */
let hashSeq = 0
const isDefaultUrl = () => {
  const clean = !!cleanUrl && doc.value === cleanUrl.doc && selected.value === cleanUrl.selected && source.value === cleanUrl.source
  return clean || (doc.value === DEFAULT_DOC && (source.value !== 'sample' || selected.value === DEFAULT_SAMPLE))
}
/** The address bar follows the format: the clean page URL for the default, else a share link (lz-string loads for the first). */
async function writeHash() {
  const seq = ++hashSeq
  if (isDefaultUrl()) return history.replaceState(null, '', location.pathname + location.search)
  const { encodeShare } = await loadShare()
  if (seq !== hashSeq) return
  history.replaceState(null, '', isDefaultUrl() ? location.pathname + location.search : encodeShare({ doc: doc.value, sample: source.value === 'sample' ? selected.value : undefined }))
}
watch([doc, selected, source], () => {
  clearTimeout(hashTimer)
  // A failed lz-string fetch just leaves the address as it was until the next change.
  hashTimer = setTimeout(() => writeHash().catch(() => {}), 300)
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

onMounted(() => {
  // Load the lazy parts when the page is idle, through each one's own loader, so that once loaded
  // the components render at once (and the settings strip's entrance plays on the first open).
  const prefetch = () => {
    for (const c of [SettingsPanel, SongTicker]) void c.__asyncLoader?.()
    prefetchTooltip()
  }
  if (window.requestIdleCallback) window.requestIdleCallback(prefetch, { timeout: 4000 })
  else setTimeout(prefetch, 2000)
  requestAnimationFrame(() => requestAnimationFrame(() => (motion.value = true)))
  document.addEventListener('keydown', onDrawerKey)
  document.addEventListener('keydown', onUndoKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDrawerKey)
  document.removeEventListener('keydown', onUndoKey)
  document.documentElement.classList.remove('scroll-locked')
})

// ---- the last playlist, remembered (paths and tags only; see lib/savedTracks.ts) ------------------
let tracksTimer: ReturnType<typeof setTimeout> | undefined
/** The track list a "too big to keep whole" note was already shown for. */
let warnedFor: Track[] | undefined
watch(
  [tracks, source, selected, tagged],
  () => {
    clearTimeout(tracksTimer)
    // After 400 ms of quiet, when the page is idle: writing a big playlist takes a while.
    tracksTimer = setTimeout(
      () =>
        whenIdle(() => {
          if (source.value === 'sample') return clearTracks(store)
          const list = tracks.value
          const kept = writeTracks(store, { source: source.value, tracks: list, selected: selected.value, tagged: tagged.value })
          if (kept < list.length && warnedFor !== list) {
            warnedFor = list
            if (kept > 0) say(`Only the first ${plural(kept, 'track')} of ${list.length} will be remembered: the rest is too much for this browser's storage.`)
          }
        }),
      400,
    )
  },
  { deep: true },
)

// ---- autosave (the format only) ------------------------------------------------------------------
let autosaveTimer: ReturnType<typeof setTimeout> | undefined
function autosaveNow() {
  clearTimeout(autosaveTimer)
  autosaveTimer = undefined
  writeLast(store, doc.value)
}
watch(doc, () => {
  clearTimeout(autosaveTimer)
  // After 800 ms of quiet, when the page is idle (pagehide below still writes at once).
  autosaveTimer = setTimeout(() => whenIdle(() => autosaveTimer !== undefined && autosaveNow()), 800)
})
const flushAutosave = () => autosaveTimer !== undefined && autosaveNow()
addEventListener('pagehide', flushAutosave)
onBeforeUnmount(() => removeEventListener('pagehide', flushAutosave))

onMounted(() => {
  if (startAction) {
    history.replaceState(null, '', location.pathname + location.search)
    void onSearchAction(startAction)
  }
  const formatRestored = start.restored && startAction?.kind !== 'recipe' && startAction?.kind !== 'saved'
  if (remembered) {
    const n = remembered.tracks.length
    say(`Restored your last playlist (${plural(n, 'track')})${formatRestored ? ' and format' : ''}.`, { label: 'Use samples', run: useSamples })
  } else if (formatRestored) {
    say('Restored your last format.', { label: 'Start fresh', run: () => replaceDoc(DEFAULT_DOC, DEFAULT_ORIGIN) })
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
  let codec: Awaited<ReturnType<typeof loadShare>>
  try {
    codec = await loadShare()
  } catch {
    return say("Couldn't make the link: check your connection and try again.")
  }
  await writeHash()
  if (location.hash === '') history.replaceState(null, '', codec.encodeShare({ doc: doc.value }))
  try {
    await navigator.clipboard.writeText(location.href)
    say('Link copied. It holds the format only, never your playlist.')
  } catch {
    say('Copy failed: your browser blocked clipboard access.')
  }
}

/**
 * Puts a whole new format in the editor as one undo step, so Ctrl+Z steps back through recipes,
 * saved formats, opened files and resets like edits. Undo and redo bring `doc` (so the share link
 * and the autosave) and `origin` back with it.
 */
function replaceDoc(text: string, from: Origin | null) {
  editor.value?.replace(text, from)
}
function loadRecipe(recipe: Recipe) {
  replaceDoc(recipe.format, recipeOrigin(recipe))
  say(`Loaded "${recipe.title}"`)
}
function loadSaved(saved: SavedFormat) {
  replaceDoc(saved.doc, { label: saved.name, text: saved.doc })
  say(`Loaded "${saved.name}"`)
}

// ---- reset (back to where the format came from) -------------------------------------------------
const resetBase = computed(() => origin.value ?? DEFAULT_ORIGIN)
const atBase = computed(() => doc.value === resetBase.value.text)
function resetEditor() {
  if (atBase.value) return
  const base = resetBase.value
  replaceDoc(base.text, base)
  // The address bar goes back to the clean page URL, and stays so until the format or track changes.
  cleanUrl = { doc: base.text, selected: selected.value, source: source.value }
  clearTimeout(hashTimer)
  hashSeq++
  history.replaceState(null, '', location.pathname + location.search)
  say(`Reset to ${base.label}`, { label: 'Undo', run: () => doc.value === base.text && editor.value?.undo() })
}
/**
 * Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y outside the editor (say, just after picking a recipe in the
 * sidebar) step through the editor's history too. Text fields keep their own undo.
 */
function onUndoKey(e: KeyboardEvent) {
  if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return
  if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return
  const key = e.key.toLowerCase()
  const run = key === 'z' ? (e.shiftKey ? 'redo' : 'undo') : key === 'y' && !e.shiftKey ? 'redo' : undefined
  if (!run) return
  e.preventDefault()
  editor.value?.[run]()
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
    // The reader's workers parse side by side: keep one file in flight per worker, in order.
    const tags: Record<string, string>[] = new Array(files.length)
    let failed = 0
    let done = 0
    let next = 0
    const lane = async () => {
      while (next < files.length && seq === readSeq) {
        const i = next++
        const f = files[i]!
        let t: Record<string, string> = { filename: f.path }
        if (reader) {
          try {
            t = await reader.readTags(f.file, f.path)
          } catch {
            failed++
          }
        }
        tags[i] = t
        done++
        if (seq === readSeq) reading.value = { done, total: files.length }
      }
    }
    await Promise.all(Array.from({ length: reader ? reader.concurrency : 1 }, lane))
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
  clearTracks(store)
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
  const named = blocks.map((b) => ({ ...b, origin: { label: blocks.length > 1 ? `${b.label} of ${file.name}` : file.name, text: b.text } }))
  atfChoices.value = named.length > 1 ? named : []
  replaceDoc(named[0]!.text, named[0]!.origin)
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
  if (running.value) return say('Still rendering the titles. Try again in a moment.')
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
            <a v-tip="TAGLINE" class="brand" href="./">
              <span class="title">atf<span class="title-rest">-playground</span></span>
            </a>
          </h1>
        </div>
        <OmniSearch class="top-search" page="playground" :ref-listed="refListed" @action="onSearchAction" />
        <div class="top-right">
          <IconButton :icon="FolderOpen" label="Open .atf" collapse="header" show-icon :icon-size="14" @click="openAtf" />
          <IconButton :icon="Download" label="Save .atf" collapse="header" show-icon :icon-size="14" @click="saveAtf" />
          <IconButton :icon="Link" label="Share link" collapse="header" show-icon :icon-size="14" @click="shareLink" />
          <ThemeToggle />
        </div>
        <input ref="atfInput" type="file" accept=".atf,.txt" hidden @change="onAtfPicked" />
      </header>

      <nav v-if="atfChoices.length" class="choices" aria-label="Formats in this file">
        <button v-for="c in atfChoices" :key="c.label" :class="{ active: c.text === doc }" @click="replaceDoc(c.text, c.origin)">{{ c.label }}</button>
        <button class="dismiss" aria-label="Close format picker" @click="atfChoices = []">✕</button>
      </nav>

      <main class="center">

        <div class="box-wrap" @keydown.esc="settingsOpen && closeSettings()">
          <button
            ref="gear"
            class="gear"
            v-tip="'Settings'"
            aria-label="Settings"
            :aria-expanded="settingsOpen"
            aria-controls="settings-panel"
            @click="settingsOpen = !settingsOpen"
          >
            <Settings :size="20" aria-hidden="true" />
          </button>
          <div class="box">
            <AtfEditor ref="editor" v-model:doc="doc" v-model:origin="origin" :findings="editorFindings" :spaces="view.spaces" class="box-editor" @format="formatEditor" />
            <div class="box-actions">
              <IconButton :icon="Copy" label="Copy" :icon-size="14" show-icon class="copy primary" title="Copy the format as one line, ready for WACUP" @click="copyFormat" />
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
          <button class="random" @click="randomRecipe"><Shuffle :size="14" aria-hidden="true" class="tab-lead" />random recipe</button>
          <div class="split" role="group" aria-label="Format or reset">
            <button v-tip="'Format: wrap at top-level boundaries (Shift+Alt+F)'" class="format" aria-label="Format (wrap at top-level boundaries)" @click="formatEditor">
              <TextWrap :size="16" aria-hidden="true" class="tab-icon" />
              <span class="tab-text">format</span>
            </button>
            <!-- aria-disabled, not disabled: it stays focusable, so its tooltip still says why it does nothing. -->
            <button
              class="reset"
              :aria-disabled="atBase"
              :aria-label="`Reset to ${resetBase.label}`"
              v-tip="atBase ? `Nothing to reset: this is ${resetBase.label} as loaded` : `Reset to ${resetBase.label} (Ctrl+Z undoes it)`"
              @click="resetEditor"
            >
              <RotateCcw :size="16" aria-hidden="true" class="tab-icon" />
              <span class="tab-text">reset</span>
            </button>
          </div>
        </div>
        <Transition name="strip">
          <SettingsPanel v-if="settingsOpen" ref="settingsPanel" v-model="view" @close="closeSettings" />
        </Transition>

        <section class="hero" aria-label="Preview">
          <SongTicker v-if="tickerMode" :row="rows[selected]" :selected="selected" :count="rows.length" :view="view" :message="heroMessage" @select="selected = $event" />
          <MiniPlaylist v-else :rows="rows" :selected="selected" :view="view" :message="heroMessage" @select="selected = $event" />
          <p v-if="format && outcome?.kind === 'timeout'" class="sub">A track didn't finish within a second, so the playground stopped it. In WACUP you'd have to end the task.</p>
          <p v-else-if="format && outcome?.kind === 'failed'" class="sub">{{ outcome.message }}</p>
          <p v-else-if="current?.freeze" class="sub">
            <a href="#" @click.prevent="pickRange(current.freeze)">${{ current.freeze.fn }}()</a> never finishes on WACUP 1.99.57.25464.
          </p>
          <p v-else-if="current?.tooHeavy" class="sub">This format builds more text than the playground will work through (tens of millions of characters along the way). WACUP may still handle it.</p>
          <p v-else-if="current?.error" class="sub error-note">There's a syntax error, so WACUP shows an error message in place of the broken part (the whole title, if it's at the top level). Details below.</p>
          <p v-if="tickerMode" class="dialect-note">Song ticker preview: the selected track, scrolling like WACUP's ticker (hover to pause). Pick another track below. Your skin's ticker font can go in Settings.</p>
          <p v-if="view.dialect === 'winamp'" class="dialect-note">Preview shows WACUP 1.99.57. Winamp 5 differs: for example <code>$if</code> tests whether a field resolved.</p>
        </section>

        <PartsTable :format="lintFormat" :parsed="parsed" @hover="hoverRange" @pick="pickRange" />
        <DiagnosticsList v-if="lintFormat" :findings="findings" :accept="acceptance" @pick="pickRange" />
        <p v-if="unsureFns.length" class="unsure-note">
          <strong>?</strong> marks output from <code v-for="f in unsureFns" :key="f">${{ f }}()</code>, which hasn't been checked against WACUP's own evaluator yet.
        </p>
      </main>

      <div class="lower">
        <TrackList
          :tracks="tracks"
          :rows="rows"
          :selected="selected"
          :view="view"
          :source="source"
          :tagged="tagged"
          :reading="reading"
          @select="selected = $event"
          @view="listView = $event"
          @set-tag="setTag"
          @open="openPicked"
          @samples="useSamples"
          @export="saveM3u8()"
        />
      </div>

      <footer>
        <span>The checking here is the same as the <a href="https://marketplace.visualstudio.com/items?itemName=gpb.atf-syntax" target="_blank" rel="noopener">ATF extension for VS Code</a>.</span> <span><a v-tip="narrow ? 'Extension docs' : undefined" class="foot-link" href="./extension/" :aria-label="narrow ? 'Extension docs' : undefined"><BookText :size="14" aria-hidden="true" /><span class="foot-text">Extension docs</span></a></span> <span><a v-tip="narrow ? 'Wiki' : undefined" class="foot-link" href="https://github.com/GhostPirateBob/atf-syntax/wiki" target="_blank" rel="noopener" :aria-label="narrow ? 'Wiki' : undefined"><BookOpen :size="14" aria-hidden="true" /><span class="foot-text">Wiki</span></a></span> <span><a v-tip="narrow ? 'Source on GitHub' : undefined" class="foot-link" href="https://github.com/GhostPirateBob/atf-syntax" target="_blank" rel="noopener" :aria-label="narrow ? 'Source on GitHub' : undefined"><GitFork :size="14" aria-hidden="true" /><span class="foot-text">Source on GitHub</span></a></span> <span><a href="./third-party-notices.txt">Third-party notices</a></span> <span>Not affiliated with or endorsed by WACUP or Winamp.</span>
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
  background: var(--chrome-bg);
  /* Secondary text readable on the raised chrome (see --muted-raised in style.css). */
  --muted: var(--muted-raised);
  --dim: var(--muted-raised);
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
/* The title; the tagline is its tooltip. */
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
  color: var(--error-text);
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
  /* As tall as the tabs that hang in it: the 36 px gear above, the 24 px tabs below (32 px on phones). */
  padding: 36px 0 24px;
}
/* Tabs on the box: the gear above its top-right corner, random recipe and format | reset below it. */
.gear,
.random,
.format,
.reset {
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
.format::before,
.reset::before {
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
.format:focus-visible::before,
.reset:not([aria-disabled='true']):hover::before,
.reset:not([aria-disabled='true']):focus-visible::before {
  opacity: 1;
}
.gear:hover,
.gear:focus-visible,
.random:hover,
.random:focus-visible,
.format:hover,
.format:focus-visible,
.reset:hover,
.reset:focus-visible {
  color: var(--tab-fg);
}
/* Each tab leaves out the border on the side it shares with the box, so it looks attached. */
.gear {
  right: 18px;
  top: 0;
  height: 36px;
  width: 36px;
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
.format:focus-visible,
.reset:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 1px;
}
.random,
.format,
.reset {
  bottom: 0;
  display: inline-flex;
  gap: 0.35em;
  height: 24px;
  /* No extra leading, so the icon and the words centre tightly. */
  line-height: 1;
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
/* format | reset: a split pair of tabs, sharing one border between them. */
.split {
  position: absolute;
  right: 18px;
  bottom: 0;
  display: flex;
}
.format,
.reset {
  position: relative;
}
.format {
  border-bottom-right-radius: 0;
}
.reset {
  border-left: 0;
  border-bottom-left-radius: 0;
}
/* format | reset: their words aren't underlined, hovered or focused either (the focus ring shows focus). */
.format,
.reset {
  text-decoration: none;
}
/* Focus ring above the neighbouring tab. */
.format:focus-visible,
.reset:focus-visible {
  z-index: 1;
}
.reset[aria-disabled='true'] {
  cursor: default;
  text-decoration: none;
  color: color-mix(in srgb, var(--tab-fg) 55%, var(--tab-bg));
}
/* Icons before the tab labels, at the labels' cap height; on phones format | reset are icons only. */
.tab-icon,
.tab-lead {
  flex: none;
  width: 14px;
  height: 14px;
}
.box {
  position: relative;
  isolation: isolate;
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
/* The brighter glow while the editor has focus: a shadow on an overlay that fades in (opacity only,
   per the motion rule), so focusing never repaints a blurred shadow. */
.box::after {
  content: '';
  position: absolute;
  inset: -3px;
  z-index: -1;
  border-radius: inherit;
  box-shadow: 0 0 24px rgba(42, 161, 152, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}
.box:focus-within::after {
  opacity: 1;
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
  gap: 0.35em;
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
  box-shadow: 0 6px 16px var(--shadow);
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
  /* Secondary text readable on the page (see --muted-text in style.css). */
  --muted: var(--muted-text);
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
/* The doc links: an icon before the words (box-tab style); on phones the icon alone, 32 px square. */
.foot-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  line-height: 1;
  vertical-align: middle;
}
.foot-link svg {
  flex: none;
}
@media (max-width: 640px) {
  .foot-link {
    justify-content: center;
    min-width: 32px;
    min-height: 32px;
  }
  .foot-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
@media (max-width: 760px) {
  /* The drawer: slides in from the left over a dimmed page (the same slide as the wide sidebar). */
  .side {
    width: min(340px, 88vw);
    z-index: 20;
    box-shadow: 4px 0 16px var(--shadow);
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
  /* "atf" on phones; screen readers still hear "atf-playground" from the visually hidden rest of
     the title. */
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
    padding-bottom: 32px;
  }
  /* Touch targets: the tabs below the box are 32 px tall on phones. */
  .random,
  .format,
  .reset {
    height: 32px;
  }
  /* Copy and save stack, so the editor keeps its width. */
  .box {
    padding-right: 8px;
  }
  .box-actions {
    flex-direction: column;
  }
  .tab-icon {
    width: 16px;
    height: 16px;
  }
  /* random recipe keeps its words on phones, without the icon. */
  .tab-lead {
    display: none;
  }
  .tab-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
}
</style>
