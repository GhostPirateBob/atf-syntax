<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { lint, parse, splitBlocks, type Finding } from '@/core'
import { toFormat } from '@/lib/document'
import { applyDisplay } from '@/lib/display'
import { EvalRunner, type RunOutcome } from '@/lib/runner'
import { decodeShare, encodeShare } from '@/lib/share'
import { RECIPES, type Recipe } from '@/lib/recipes'
import { SAMPLE_TRACKS, fieldsFor, newId, trackLabel, tracksFromPlaylist, type Track } from '@/lib/tracks'
import type { PlaylistEntry } from '@/lib/m3u'
import { fontStack, fontWeight } from '@/lib/measure'
import AtfEditor from './components/AtfEditor.vue'
import PartsTable from './components/PartsTable.vue'
import DiagnosticsList from './components/DiagnosticsList.vue'
import TrackList, { type Row } from './components/TrackList.vue'
import DisplaySettings, { type ViewSettings } from './components/DisplaySettings.vue'
import SideBar from './components/SideBar.vue'

const DEFAULT_DOC = '[%artist% - ]$if2(%title%,$filepart(%filename%))'
const VIEW_KEY = 'atf-playground:view'
const MAX_PLAYLIST = 500

const cloneSamples = (): Track[] => SAMPLE_TRACKS.map((t) => ({ ...t, id: newId(), tags: { ...t.tags } }))

// ---- state -------------------------------------------------------------------------------
const shared = decodeShare(location.hash)
const doc = ref(shared?.doc ?? DEFAULT_DOC)
const tracks = ref<Track[]>(cloneSamples())
const source = ref<'sample' | 'playlist'>('sample')
const selected = ref(Math.min(shared?.sample ?? 0, tracks.value.length - 1))
const sidebarOpen = ref(window.innerWidth >= 1100)
const view = ref<ViewSettings>(loadView())
const editor = ref<InstanceType<typeof AtfEditor>>()
const toast = ref('')
const atfInput = ref<HTMLInputElement>()
const atfChoices = ref<{ label: string; text: string }[]>([])

function loadView(): ViewSettings {
  const base: ViewSettings = { trimLeading: true, underscoresToSpaces: true, pct20ToSpaces: true, font: '', fontSize: 16, width: 0 }
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') }
  } catch {
    return base
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
const findings = computed<Finding[]>(() => (format.value ? lint(format.value, { dialect: 'wacup', result: parsed.value }) : []))

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
  const result = await runner.run(format.value, tracks.value.map(fieldsFor))
  if (seq === runSeq) outcome.value = result
}
onBeforeUnmount(() => runner.dispose())

const rows = computed<Row[]>(() =>
  tracks.value.map((t, i) => {
    const base = { label: trackLabel(t), cached: t.cachedTitle, unsure: false }
    const o = outcome.value
    if (!format.value) return { ...base, text: '', state: 'ok' }
    if (!o) return { ...base, text: '', state: 'pending' }
    if (o.kind === 'timeout') return { ...base, text: '', state: 'timeout' }
    if (o.kind === 'failed') return { ...base, text: '', state: 'pending' }
    const r = o.results[i]
    if (!r) return { ...base, text: '', state: 'pending' }
    if (r.freeze) return { ...base, text: '', state: 'freeze', unsure: r.unsure.length > 0 }
    if (r.tooHeavy) return { ...base, text: '', state: 'heavy' }
    if (r.error) return { ...base, text: r.text, state: 'error' }
    return { ...base, text: applyDisplay(r.text, view.value), state: 'ok', unsure: r.unsure.length > 0 }
  }),
)

const current = computed(() => (outcome.value?.kind === 'ok' ? outcome.value.results[selected.value] : undefined))
const nextIndex = computed(() => (tracks.value.length > 1 ? (selected.value + 1) % tracks.value.length : -1))
const unsureFns = computed(() => {
  if (outcome.value?.kind !== 'ok') return []
  return [...new Set(outcome.value.results.flatMap((r) => r.unsure))].sort()
})
const heroFont = computed(() => ({ fontFamily: fontStack(view.value.font), fontWeight: fontWeight(view.value.font) }))

// ---- share link (format + sample only, never playlist data) --------------------------------------------
let hashTimer: ReturnType<typeof setTimeout> | undefined
function writeHash() {
  const isDefault = doc.value === DEFAULT_DOC && (source.value !== 'sample' || selected.value === 0)
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

function importPlaylist(entries: PlaylistEntry[]) {
  if (!entries.length) return say('No tracks found in that playlist.')
  tracks.value = tracksFromPlaylist(entries.slice(0, MAX_PLAYLIST))
  source.value = 'playlist'
  selected.value = 0
  say(entries.length > MAX_PLAYLIST ? `Loaded the first ${MAX_PLAYLIST} of ${entries.length} tracks.` : `Loaded ${entries.length} track${entries.length === 1 ? '' : 's'}: paths and lengths only, no tags.`)
}
function useSamples() {
  tracks.value = cloneSamples()
  source.value = 'sample'
  selected.value = 0
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
        <input ref="atfInput" type="file" accept=".atf,.txt" hidden @change="onAtfPicked" />
      </header>

      <nav v-if="atfChoices.length" class="choices">
        <button v-for="c in atfChoices" :key="c.label" :class="{ active: c.text === doc }" @click="doc = c.text">{{ c.label }}</button>
        <button class="dismiss" aria-label="Close format picker" @click="atfChoices = []">✕</button>
      </nav>

      <main class="center">
        <h1 class="title">atf playground</h1>
        <p class="tagline">Advanced Title Formatting for WACUP &amp; Winamp, live</p>

        <section class="hero" :style="heroFont">
          <template v-if="!format">
            <p class="quote muted">Type a title format below</p>
          </template>
          <template v-else-if="outcome?.kind === 'timeout'">
            <p class="quote warn">⚠ This would freeze WACUP</p>
            <p class="sub">It didn't finish within a second, so the playground stopped it. In WACUP you'd have to end the task.</p>
          </template>
          <template v-else-if="outcome?.kind === 'failed'">
            <p class="quote warn">The evaluator couldn't start</p>
            <p class="sub">{{ outcome.message }}</p>
          </template>
          <template v-else-if="current?.freeze">
            <p class="quote warn">⚠ This would freeze WACUP</p>
            <p class="sub">
              <a href="#" @click.prevent="pickRange(current.freeze)">${{ current.freeze.fn }}()</a> never finishes on WACUP 1.99.57.25464.
            </p>
          </template>
          <template v-else-if="current?.tooHeavy">
            <p class="quote warn">Too heavy to preview</p>
            <p class="sub">This format builds more text than the playground will work through (tens of millions of characters along the way). WACUP may still handle it.</p>
          </template>
          <template v-else-if="current?.error">
            <p class="quote">{{ rows[selected]?.text ?? current.text }}</p>
            <p class="sub error-note">There's a syntax error, so WACUP shows an error message in place of the broken part (the whole title, if it's at the top level). Details below.</p>
          </template>
          <template v-else>
            <p class="quote">{{ rows[selected]?.text ?? '' }}</p>
            <p v-if="nextIndex >= 0" class="sub">
              <a href="#" @click.prevent="selected = nextIndex">next</a>
              <span class="muted"> track </span>
              <span class="next">{{ rows[nextIndex]?.text }}</span>
            </p>
          </template>
        </section>

        <div class="box-wrap">
          <button class="random" @click="randomRecipe">random recipe</button>
          <div class="box">
            <AtfEditor ref="editor" v-model:doc="doc" :findings="findings" class="box-editor" />
            <button class="copy primary" title="Copy the format as one line, ready for WACUP" @click="copyFormat">Copy</button>
          </div>
        </div>

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
          @select="selected = $event"
          @set-tag="setTag"
          @import="importPlaylist"
          @samples="useSamples"
        />
        <DisplaySettings v-model="view" />
      </section>

      <footer>
        <span>The checking here is the same as the <a href="https://marketplace.visualstudio.com/items?itemName=gpb.atf-syntax" target="_blank" rel="noopener">ATF extension for VS Code</a>.</span>
        <span><a href="https://github.com/GhostPirateBob/atf-syntax" target="_blank" rel="noopener">Source on GitHub</a></span>
        <span class="muted">Not affiliated with or endorsed by WACUP or Winamp.</span>
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
  margin: 4px 0 26px;
  color: var(--muted);
}
.hero {
  min-height: 6.5em;
  margin-bottom: 14px;
}
.quote {
  font-size: clamp(1.3rem, 3.2vw, 2.1rem);
  font-style: italic;
  color: var(--bright);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.quote.warn {
  color: var(--warning);
  font-style: normal;
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
.next {
  color: var(--text);
  white-space: pre-wrap;
}
.box-wrap {
  position: relative;
  max-width: 960px;
  margin: 0 auto;
  padding-top: 22px;
}
.random {
  position: absolute;
  right: 18px;
  top: 0;
  font-family: var(--mono);
  font-size: 0.82rem;
  background: var(--teal);
  border-color: var(--teal);
  color: var(--bright);
  border-radius: 4px 4px 0 0;
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
  font-size: 0.88rem;
  color: var(--warning);
}
.unsure-note code {
  margin: 0 3px;
}
.lower {
  display: grid;
  gap: 12px;
  max-width: 1100px;
  width: 100%;
  margin: 24px auto 0;
  padding: 0 20px;
}
footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  justify-content: center;
  padding: 26px 20px 30px;
  font-size: 0.85rem;
  color: var(--text);
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
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.6);
  }
  .center {
    padding-top: 22px;
  }
}
</style>
