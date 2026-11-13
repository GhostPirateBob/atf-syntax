<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type ComponentPublicInstance } from 'vue'
import { ClipboardPaste, FileMusic, FolderSearch, Info, ListMusic, ListRestart } from '@lucide/vue'
import IconButton from './IconButton.vue'
import { EDITABLE_TAGS, type Track } from '@/lib/tracks'
import { parseM3u } from '@/lib/m3u'
import { AUDIO_EXTENSIONS, PLAYLIST_EXTENSIONS } from '@/lib/audio'
import { filesFromDrop, filesFromInput, sortPicked, type Picked } from '@/lib/pick'
import { titleFont } from '@/lib/fontStacks'
import { clampFontSize, type ViewSettings } from '@/lib/view'
import { fitRow, fontsLoaded, useWidth } from '@/lib/rowFit'
import { reducedMotion } from '@/lib/media'
import { rowOffsets, rowsInView, scrollToShow, visibleWindow } from '@/lib/virtualList'
import throttle from 'lodash-es/throttle'
import { frames } from '@/lib/timing'

export interface Row {
  label: string
  /** Output after WACUP's display habits, or '' while pending. */
  text: string
  /** The track's length (`m:ss`), or '' if unknown. */
  duration: string
  state: 'ok' | 'freeze' | 'heavy' | 'error' | 'timeout' | 'pending'
  unsure: boolean
  cached?: string
}

const props = defineProps<{
  tracks: Track[]
  rows: Row[]
  selected: number
  view: ViewSettings
  source: 'sample' | 'playlist' | 'files'
  /** Playlist tracks that got tags from the user's files. */
  tagged: number
  /** Files read so far, while tags are being read. */
  reading: { done: number; total: number } | null
}>()
const emit = defineEmits<{
  select: [index: number]
  setTag: [index: number, key: string, value: string]
  open: [picked: Picked]
  samples: []
  export: []
  /** The rows in the list's view (track indices), whenever they change. */
  view: [indices: number[]]
}>()

const editing = ref<number | null>(null)
const pasting = ref(false)
const pasted = ref('')
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
const ACCEPT = [...PLAYLIST_EXTENSIONS, ...AUDIO_EXTENSIONS].map((e) => `.${e}`).join(',')

/** The Save .m3u8 tooltip: why it's off, or the one thing to know before using the file. */
const exportTitle = computed(() =>
  props.source === 'playlist'
    ? "Save as winamp.m3u8 with these titles. Close WACUP before replacing its winamp.m3u8 (in WACUP's Settings folder): it rewrites the file on exit. WACUP shows these titles until it re-reads a track's tags, e.g. when it plays."
    : 'Load a playlist first: files you pick only give the page their names, not full paths.',
)

const sourceLabel = computed(() => {
  if (props.source === 'files') return 'from your files'
  if (props.source === 'playlist') return props.tagged ? `from your playlist, ${props.tagged} with tags from your files` : 'from your playlist'
  return 'samples'
})

/** Playlist entries without tags read from files: a playlist alone has only paths and lengths. */
const untagged = computed(() => (props.source === 'playlist' && !props.reading ? props.tracks.length - props.tagged : 0))

const font = computed(() => titleFont(props.view.font, props.view.fontFamily))
const fontSize = computed(() => clampFontSize(props.view.fontSize))
const numberPrefix = (i: number) => (props.view.numbers ? `${i + 1}. ` : '')

// ---- the list: five rows high, scrolling inside, virtualised ------------------------------------
// Only the rows in view (plus a few each side) get DOM; padding on the list stands in for the rest,
// so a 5,000-track playlist costs about as much as a short one. Nothing here reads layout: row
// heights come from a ResizeObserver, the scroll position from scroll events.
/** Rows shown before the list scrolls. */
const VISIBLE_ROWS = 5
/** Rows rendered beyond each edge of the view, so a scroll or a key press rarely shows a gap. */
const OVERSCAN = 4
/** A row's height until one is measured (a 16 px title, the meta line, padding and the rule). */
const DEFAULT_ROW = 44
const rowsEl = ref<HTMLDivElement>()
/** One row's height (its title line, the meta line and the rule), measured from a row whose tag editor is shut. */
const rowHeight = ref(0)
/** Measured heights by track id: an open tag editor or a wrapped meta line makes a row taller. */
const heights = shallowRef(new Map<string, number>())
const scrollTop = ref(0)
/** Row sizes seen since the last update, by track id (the latest of each), and a row height without a tag editor. */
let seen = new Map<string, number>()
let plainSeen = 0
// Taken at most every two frames (the first at once, the last always), so a resize drag doesn't
// re-lay the list on every frame but always ends at the final sizes.
const applySizes = throttle(
  () => {
    let next: Map<string, number> | undefined
    for (const [id, h] of seen) if (heights.value.get(id) !== h) (next ??= new Map(heights.value)).set(id, h)
    if (next) heights.value = next
    if (plainSeen && plainSeen !== rowHeight.value) rowHeight.value = plainSeen
    seen = new Map()
    plainSeen = 0
  },
  frames(2),
  { leading: true, trailing: true },
)
const rowObserver = new ResizeObserver((entries) => {
  for (const e of entries) {
    const li = e.target as HTMLElement
    const id = li.dataset.id
    const h = e.borderBoxSize?.[0]?.blockSize
    if (!id || !h) continue
    if (!plainSeen && !li.querySelector('.editor')) plainSeen = h
    seen.set(id, h)
  }
  applySizes()
})
onBeforeUnmount(() => {
  rowObserver.disconnect()
  applySizes.cancel()
})
/** Observes each rendered row as it mounts (an unmounted row drops out of the observer by itself). */
function observeRow(el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) rowObserver.observe(el)
}
// A new list, or a font change: the measured heights no longer apply.
watch([() => props.tracks, () => props.tracks.length, fontSize, () => font.value.family, () => props.view.numbers], () => (heights.value = new Map()))

const estimate = computed(() => rowHeight.value || DEFAULT_ROW)
const offsets = computed(() => {
  const h = heights.value
  const est = estimate.value
  const list = props.tracks
  return rowOffsets(list.length, (i) => h.get(list[i]!.id) ?? est)
})
/** The list's height: five rows, or less for a shorter playlist (what the CSS max-height gives). */
const viewport = computed(() => (rowHeight.value ? Math.min(VISIBLE_ROWS * rowHeight.value, offsets.value[props.tracks.length] ?? 0) : 0))
const win = computed(() => visibleWindow(offsets.value, scrollTop.value, viewport.value, OVERSCAN))
const shown = computed(() => {
  const { start, end } = win.value
  return props.tracks.slice(start, end).map((t, k) => ({ t, i: start + k }))
})
/** The scrolling box: five rows high once a row is measured. */
const scrollStyle = computed(() => (rowHeight.value ? { maxHeight: `${VISIBLE_ROWS * rowHeight.value}px` } : {}))
/** Padding above and below the rendered rows, standing in for the rest (the list isn't the scrolling box, so it adds height). */
const listStyle = computed(() => ({ paddingTop: `${win.value.padTop}px`, paddingBottom: `${win.value.padBottom}px` }))
// The rows on screen go to the evaluator first.
watch(
  () => rowsInView(offsets.value, scrollTop.value, viewport.value).join(','),
  (list) => emit('view', list ? list.split(',').map(Number) : []),
  { immediate: true },
)
function onScroll() {
  if (rowsEl.value) scrollTop.value = rowsEl.value.scrollTop
}

// Every row's title area is as wide as the first rendered one's: the playlist width, or less on a narrow screen.
const firstLine = ref<HTMLElement>()
const setLine = (i: number, el: Element | ComponentPublicInstance | null) => {
  if (i === win.value.start) firstLine.value = (el as HTMLElement | null) ?? undefined
}
const lineWidth = useWidth(firstLine)
/** A title cut WACUP-style ("Long Tit... 4:20") to fit beside the duration (cached, see fitRow). */
function fitted(i: number): string {
  void fontsLoaded.value
  const r = props.rows[i]
  if (!r) return ''
  return fitRow(r.text, { duration: r.duration, prefix: numberPrefix(i), width: lineWidth.value, font: `${font.value.weight} ${fontSize.value}px ${font.value.family}`, gap: fontSize.value * 0.4 })
}

/**
 * Scrolls the list (only the list, never the page) so the selected row shows, e.g. after Up/Down
 * on the preview. `instant` for keyboard moves inside the list, so the row is rendered at once.
 */
function keepSelectedInView(instant = false) {
  const ol = rowsEl.value
  if (!ol || !viewport.value) return
  const top = scrollToShow(offsets.value, props.selected, scrollTop.value, viewport.value)
  if (top === scrollTop.value) return
  // A long way (Home or End on the preview): jump, as a smooth scroll would render every row it passes.
  const jump = instant || reducedMotion() || Math.abs(top - scrollTop.value) > 10 * viewport.value
  ol.scrollTo({ top, behavior: jump ? 'auto' : 'smooth' })
  if (jump) scrollTop.value = top
}
watch(() => props.selected, () => keepSelectedInView())
// Once the row height is known (the first measurement), bring a selected track further down into view.
watch(viewport, (now, before) => {
  if (now && !before) keepSelectedInView(true)
})

/** Up, Down, Home and End on a row move the selection, so every track can be reached from the keyboard. */
async function onRowKey(e: KeyboardEvent, i: number) {
  const n = props.tracks.length
  const to = ({ ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: n - 1 } as Record<string, number>)[e.key]
  if (to === undefined || to < 0 || to >= n) return
  e.preventDefault()
  emit('select', to)
  await nextTick()
  keepSelectedInView(true)
  await nextTick()
  rowsEl.value?.querySelector<HTMLElement>(`li[data-index="${to}"] .out`)?.focus({ preventScroll: true })
}

async function onDrop(e: DragEvent) {
  dragging.value = false
  if (!e.dataTransfer) return
  emit('open', await sortPicked(await filesFromDrop(e.dataTransfer)))
}
async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = filesFromInput(input.files)
  input.value = ''
  if (files.length) emit('open', await sortPicked(files))
}
function importPasted() {
  emit('open', { entries: parseM3u(pasted.value), audio: [] })
  pasted.value = ''
  pasting.value = false
}
</script>

<template>
  <section class="tracks" aria-labelledby="tracks-heading" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
    <header>
      <h2 id="tracks-heading">Tracks</h2>
      <span class="muted count">{{ tracks.length }} {{ sourceLabel }}</span>
      <span v-if="reading" class="count reading" role="status">Reading {{ reading.done }} / {{ reading.total }}…</span>
      <span class="spacer" />
      <span class="actions">
        <IconButton :icon="FileMusic" label="Open files…" show-icon :icon-size="14" title="Open files: a playlist, audio files, or both" @click="fileInput?.click()" />
        <IconButton :icon="FolderSearch" label="Open folder…" show-icon :icon-size="14" title="Open folder: read the tags of every audio file in a folder" @click="folderInput?.click()" />
        <IconButton :icon="ClipboardPaste" label="Paste playlist" show-icon :icon-size="14" :aria-expanded="pasting" @click="pasting = !pasting" />
        <IconButton :icon="ListMusic" label="Save .m3u8" show-icon :icon-size="14" :title="exportTitle" :disabled="source !== 'playlist'" @click="emit('export')" />
        <IconButton v-if="source !== 'sample'" :icon="ListRestart" label="Back to samples" show-icon :icon-size="14" @click="emit('samples')" />
      </span>
      <input name="audio-files" ref="fileInput" type="file" :accept="ACCEPT" multiple hidden @change="onPick" />
      <input name="audio-folder" ref="folderInput" type="file" webkitdirectory hidden @change="onPick" />
    </header>

    <div v-if="untagged" class="notice" role="status">
      <Info :size="18" aria-hidden="true" class="notice-icon" />
      <p v-if="tagged === 0">
        <strong>No tags yet for {{ untagged }} of {{ tracks.length }} tracks.</strong>
        Your browser can't open files from the paths in a playlist, so fields like <code>%artist%</code> are empty and <code>$filepart()</code> shows file names.
        Drop the audio files or their folder here, or <button class="link" @click="folderInput?.click()">Open folder…</button>, to read the tags.
        Only the files this playlist names are read, and they stay on your computer.
      </p>
      <p v-else>
        <strong>No tags yet for {{ untagged }} of {{ tracks.length }} tracks.</strong>
        To read their tags, drop their files or folder here, or use <button class="link" @click="folderInput?.click()">Open folder…</button>
      </p>
    </div>

    <div v-if="pasting" class="paste">
      <textarea name="pasted-playlist" v-model="pasted" rows="5" placeholder="#EXTM3U&#10;#EXTINF:223,Artist - Title&#10;D:\Music\Artist\Album\01 Title.mp3" />
      <div class="paste-actions">
        <button class="primary" :disabled="!pasted.trim()" @click="importPasted">Use these tracks</button>
        <span class="muted">Stays in your browser. Share links never include playlist data.</span>
      </div>
    </div>

    <div ref="rowsEl" class="rows-scroll" :style="scrollStyle" @scroll.passive="onScroll">
      <ol
        class="rows"
        :style="{ ...listStyle, '--row-font': font.family, '--row-size': `${fontSize}px`, '--row-weight': font.weight, '--pl-width': view.width ? `${view.width}px` : '100%' }"
      >
        <li
          v-for="{ t, i } in shown"
          :key="t.id"
          :ref="observeRow"
          :data-id="t.id"
          :data-index="i"
          :aria-setsize="tracks.length"
          :aria-posinset="i + 1"
          :class="{ selected: i === selected }"
        >
          <div class="row">
            <button class="out stretched playlist-text" :class="rows[i]?.state" :aria-pressed="i === selected" :title="rows[i]?.text" @click="emit('select', i)" @keydown="onRowKey($event, i)">
              <span :ref="(el) => setLine(i, el)" class="line">
                <span class="t">
                  <span v-if="view.numbers" class="num">{{ numberPrefix(i) }}</span>
                  <template v-if="rows[i]?.state === 'freeze'">⚠ would freeze WACUP</template>
                  <template v-else-if="rows[i]?.state === 'timeout'">⚠ didn't finish</template>
                  <template v-else-if="rows[i]?.state === 'heavy'">⚠ too heavy to preview</template>
                  <template v-else-if="fitted(i)">{{ fitted(i) }}</template><template v-else>{{ ' ' }}</template>
                </span>
                <span v-if="rows[i]?.duration" class="dur">{{ rows[i]?.duration }}</span>
              </span>
            </button>
            <button class="edit" :aria-label="`Edit tags of ${rows[i]?.label}`" @click.stop="editing = editing === i ? null : i">tags</button>
          </div>
          <div class="meta">
            <span class="label">{{ rows[i]?.label }}</span>
            <span v-if="rows[i]?.unsure" class="unsure" title="Uses a function not yet confirmed against WACUP's own evaluator">? unconfirmed</span>
            <span v-if="rows[i]?.cached" class="cached" title="The #EXTINF title in your playlist: what WACUP showed when it last saved it. May be stale or from an older format.">WACUP showed (cached): {{ rows[i]?.cached }}</span>
          </div>
          <div v-if="editing === i" class="editor">
            <label v-for="key in EDITABLE_TAGS" :key="key">
              <span class="mono">%{{ key }}%</span>
              <input type="text" :name="`tag-${key}`" :value="t.tags[key] ?? ''" @input="emit('setTag', i, key, ($event.target as HTMLInputElement).value)" />
            </label>
          </div>
        </li>
      </ol>
    </div>
    <p class="drop-hint muted">
      Drop an <code>.m3u8</code> here to see your own tracks, with the audio files or their folder to read the tags. Your files stay on your computer.
      Without a playlist, your browser only gives the page file names, not full paths, so <code>%filename%</code> and <code>%folder%</code> start at the folder you picked.
      Your last playlist (paths and tags only) is remembered in this browser.
    </p>
  </section>
</template>

<style scoped>
.tracks {
  /* Secondary text readable on the panel and on a selected row (see --muted-text in style.css). */
  --muted: var(--muted-text);
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  padding: 10px 12px;
}
.tracks.dragging {
  border-color: var(--teal);
  box-shadow: 0 0 0 3px var(--glow);
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
h2 {
  margin: 0;
  font-size: 1rem;
  color: var(--bright);
}
.count {
  font-size: 0.85rem;
}
.reading {
  color: var(--cyan);
}
.spacer {
  flex: 1;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.notice {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 10px 0 2px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--info) 45%, var(--border));
  border-left: 4px solid var(--info);
  border-radius: 4px;
  background: color-mix(in srgb, var(--info) 9%, var(--panel));
  color: var(--bright);
  font-size: 0.88rem;
  text-align: left;
}
.notice p {
  margin: 0;
}
.notice-icon {
  flex: none;
  margin-top: 2px;
  color: var(--info);
}
.notice .link {
  display: inline;
  padding: 0 4px;
  border-color: var(--info);
  color: var(--bright);
  font-weight: 600;
  white-space: nowrap;
}
.notice .link:focus-visible {
  outline: 2px solid var(--info);
  outline-offset: 1px;
}
.paste {
  margin-top: 8px;
}
.paste textarea {
  width: 100%;
  font-family: var(--mono);
  font-size: 0.85rem;
}
.paste-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 0.85rem;
}
/* At most five rows high (the max-height is measured in script), scrolling inside. Only the rows
   in view are rendered; the list's padding (set in script) stands in for the others. */
.rows-scroll {
  margin: 10px 0 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* Room for the scrollbar kept either way, so its coming and going never changes the rows' width. */
  scrollbar-gutter: stable;
}
.rows {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  position: relative;
  /* A hover or selection repaints only this row. */
  contain: paint;
  border-top: 1px solid var(--border);
  padding: 4px 6px;
  border-left: 3px solid transparent;
  cursor: pointer;
}
/* Hover and selection tints over the panel, as solid colours. */
li:hover {
  background: color-mix(in srgb, rgb(var(--tint-rgb)) 25%, var(--panel));
}
/* Stretched link: the select button's ::after covers the whole row, so a click anywhere selects
   the track, while keyboard and screen-reader users still get one real button per row. */
.stretched::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
}
.num {
  color: var(--muted);
}
/* Controls that must stay clickable sit above the stretched area. */
.edit,
.editor {
  position: relative;
  z-index: 2;
}
li.selected {
  border-left-color: var(--gold);
  background: color-mix(in srgb, rgb(var(--tint-rgb)) 35%, var(--panel));
}
.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.out {
  flex: 1;
  min-width: 0;
  display: block;
  text-align: left;
  background: none;
  border: none;
  border-radius: 0;
  padding: 0;
  cursor: pointer;
  font-family: var(--row-font);
  font-size: var(--row-size);
  font-weight: var(--row-weight);
  color: var(--bright);
  white-space: pre;
}
/* Title and duration across the playlist width, like a WACUP row. */
.line {
  display: flex;
  width: var(--pl-width);
  max-width: 100%;
}
.t {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  /* Only reached by the warning texts; titles are cut to fit beforehand. */
  text-overflow: ellipsis;
}
.dur {
  margin-left: 0.4em;
}
.out:hover,
.out:focus-visible {
  color: var(--bright);
}
.out:focus-visible::after {
  outline: 2px solid var(--teal);
  outline-offset: -2px;
}
.out.freeze,
.out.heavy,
.out.timeout {
  color: var(--error-text);
  font-family: var(--sans);
}
.out.error {
  color: var(--error-text);
}
.edit {
  font-size: 0.75rem;
  padding: 0 6px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 0.78rem;
  color: var(--muted);
}
.unsure {
  color: var(--warning-text);
}
.cached {
  font-style: italic;
}
.editor {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 4px 12px;
  margin: 6px 0 4px;
}
.editor label {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 0.82rem;
}
.editor .mono {
  width: 120px;
  color: var(--gold);
}
.editor input {
  flex: 1;
  min-width: 0;
}
.drop-hint {
  font-size: 0.8rem;
  margin: 8px 0 0;
}
</style>
