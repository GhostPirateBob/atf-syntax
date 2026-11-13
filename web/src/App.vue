<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { lint, parse, splitBlocks, type Finding } from '@/core'
import { toFormat } from '@/lib/document'
import { applyDisplay } from '@/lib/display'
import { EvalRunner, type RunOutcome } from '@/lib/runner'
import { decodeShare, encodeShare } from '@/lib/share'
import { RECIPES, type Recipe } from '@/lib/recipes'
import { SAMPLE_TRACKS, durationOf, fieldsFor, newId, trackLabel, tracksFromFiles, tracksFromPlaylist, type Track } from '@/lib/tracks'
import type { PlaylistEntry } from '@/lib/m3u'
import { matchPlaylistFiles } from '@/lib/audio'
import type { Picked, PickedFile } from '@/lib/pick'
import { parseView, type ViewSettings } from '@/lib/view'
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
const doc = ref(shared?.doc ?? DEFAULT_DOC)
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
const view = ref<ViewSettings>(loadView())
const editor = ref<InstanceType<typeof AtfEditor>>()
const toast = ref('')
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
const findings = computed<Finding[]>(() => (format.value ? lint(format.value, { dialect: view.value.dialect, result: parsed.value }) : []))

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
    const base = { label: trackLabel(t), duration: durationOf(t), cached: t.cachedTitle, unsure: false }
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

/** Titles are shown on one line, as in a playlist: line breaks (e.g. from $crlf()) are removed. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, '')

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

// ---- actions -------------------------------------------------------------------------------
let toastTimer: ReturnType<typeof setTimeout> | undefined
function say(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
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
  say(`Loaded "${recipe.title}"`)
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

function pickRange(range: { start: number; end: number }) {
  editor.value?.select(range.start, range.end)
}
function hoverRange(range: { start: number; end: number } | null) {
  editor.value?.focusRange(range)
}
</script>

<template>
  <div class="app" :class="{ 'with-sidebar': sidebarOpen }">
    <SideBar v-if="sidebarOpen" class="side" @insert="editor?.insert($event)" @load="loadRecipe" @close="sidebarOpen = false" />

    <div class="main">
      <header class="top">
        <button v-if="!sidebarOpen" @click="sidebarOpen = true">☰ Recipes &amp; reference</button>
        <span class="spacer" />
        <button @click="openAtf">Open .atf</button>
        <button @click="saveAtf">Save .atf</button>
        <button @click="shareLink">Share link</button>
        <ThemeToggle />
        <input ref="atfInput" type="file" accept=".atf,.txt" hidden @change="onAtfPicked" />
      </header>

      <nav v-if="atfChoices.length" class="choices">
        <button v-for="c in atfChoices" :key="c.label" :class="{ active: c.text === doc }" @click="doc = c.text">{{ c.label }}</button>
        <button class="dismiss" aria-label="Close format picker" @click="atfChoices = []">✕</button>
      </nav>

      <main class="center">
        <h1 class="title">atf playground</h1>
        <p class="tagline"><small>Advanced Title Formatting for WACUP &amp; Winamp, live</small></p>

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
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
          </button>
          <div class="box">
            <AtfEditor ref="editor" v-model:doc="doc" :findings="findings" class="box-editor" />
            <button class="copy primary" title="Copy the format as one line, ready for WACUP" @click="copyFormat">Copy</button>
          </div>
          <button class="random" @click="randomRecipe">random recipe</button>
        </div>
        <SettingsPanel v-if="settingsOpen" ref="settingsPanel" v-model="view" @close="closeSettings" />

        <section class="hero">
          <MiniPlaylist :rows="rows" :selected="selected" :view="view" :message="heroMessage" @select="selected = $event" />
          <p v-if="format && outcome?.kind === 'timeout'" class="sub">It didn't finish within a second, so the playground stopped it. In WACUP you'd have to end the task.</p>
          <p v-else-if="format && outcome?.kind === 'failed'" class="sub">{{ outcome.message }}</p>
          <p v-else-if="current?.freeze" class="sub">
            <a href="#" @click.prevent="pickRange(current.freeze)">${{ current.freeze.fn }}()</a> never finishes on WACUP 1.99.57.25464.
          </p>
          <p v-else-if="current?.tooHeavy" class="sub">This format builds more text than the playground will work through (tens of millions of characters along the way). WACUP may still handle it.</p>
          <p v-else-if="current?.error" class="sub error-note">There's a syntax error, so WACUP shows an error message in place of the broken part (the whole title, if it's at the top level). Details below.</p>
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
        />
      </section>

      <footer>
        <span>The checking here is the same as the <a href="https://marketplace.visualstudio.com/items?itemName=gpb.atf-syntax" target="_blank" rel="noopener">ATF extension for VS Code</a>.</span> <span><a href="./extension/">Extension docs</a></span> <span><a href="https://github.com/GhostPirateBob/atf-syntax" target="_blank" rel="noopener">Source on GitHub</a></span> <span><a href="./third-party-notices.txt">Third-party notices</a></span> <span>Not affiliated with or endorsed by WACUP or Winamp.</span>
      </footer>
    </div>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 1fr;
  min-height: 100vh;
}
.app.with-sidebar {
  grid-template-columns: minmax(280px, 340px) 1fr;
}
.side {
  position: sticky;
  top: 0;
  height: 100vh;
}
.main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.top {
  display: flex;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--sidebar);
}
.spacer {
  flex: 1;
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
  padding: 34px 20px 10px;
  text-align: center;
}
.title {
  font-family: var(--mono);
  font-size: clamp(2rem, 5vw, 3rem);
  font-weight: 700;
  color: var(--blue);
  margin: 0;
  letter-spacing: 0.02em;
}
.tagline {
  margin: 4px 0 24px;
  color: var(--muted);
}
.tagline small {
  font-size: 0.85rem;
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
  margin: 0 auto;
  padding: 30px 0 24px;
}
/* Tabs on the box: the gear above its top-right corner, random recipe below its bottom-left. */
.gear,
.random {
  position: absolute;
  background: var(--tab-bg);
  border-color: var(--teal);
  color: var(--tab-fg);
  text-align: center;
  align-items: center;
}
.gear:hover,
.gear:focus-visible,
.random:hover,
.random:focus-visible {
  background: color-mix(in srgb, var(--tab-bg) 85%, var(--teal));
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
  transition: transform 0.2s;
}
.gear[aria-expanded='true'] svg {
  transform: rotate(45deg);
}
.gear:focus-visible,
.random:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 1px;
}
.random {
  left: 18px;
  bottom: 0;
  height: 24px;
  padding: 0 10px;
  font-family: var(--mono);
  font-size: 0.82rem;
  border-top: 0;
  border-radius: 0 0 4px 4px;
  text-decoration: underline;
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
.copy {
  align-self: center;
  font-weight: 600;
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
  .app.with-sidebar {
    grid-template-columns: 1fr;
  }
  .side {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(340px, 90vw);
    z-index: 20;
    box-shadow: 4px 0 24px var(--shadow);
  }
  .center {
    padding-top: 22px;
  }
}
</style>
