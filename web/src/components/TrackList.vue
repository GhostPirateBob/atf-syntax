<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from 'vue'
import { ClipboardPaste, FileMusic, Folder, Info, RotateCcw } from '@lucide/vue'
import IconButton from './IconButton.vue'
import { EDITABLE_TAGS, type Track } from '@/lib/tracks'
import { parseM3u } from '@/lib/m3u'
import { AUDIO_EXTENSIONS, PLAYLIST_EXTENSIONS } from '@/lib/audio'
import { filesFromDrop, filesFromInput, sortPicked, type Picked } from '@/lib/pick'
import { titleFont } from '@/lib/fontStacks'
import { clampFontSize, type ViewSettings } from '@/lib/view'
import { fitRow, fontsLoaded, useWidth } from '@/lib/rowFit'

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
}>()

const editing = ref<number | null>(null)
const pasting = ref(false)
const pasted = ref('')
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
const ACCEPT = [...PLAYLIST_EXTENSIONS, ...AUDIO_EXTENSIONS].map((e) => `.${e}`).join(',')

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
// Every row's title area is as wide as the first one's: the playlist width, or less on a narrow screen.
const firstLine = ref<HTMLElement>()
const setLine = (i: number, el: Element | ComponentPublicInstance | null) => {
  if (i === 0) firstLine.value = (el as HTMLElement | null) ?? undefined
}
const lineWidth = useWidth(firstLine)
/** Titles cut WACUP-style ("Long Tit... 4:20") to fit beside the duration. */
const fitted = computed(() => {
  void fontsLoaded.value
  const css = `${font.value.weight} ${fontSize.value}px ${font.value.family}`
  return props.rows.map((r, i) => fitRow(r.text, { duration: r.duration, prefix: numberPrefix(i), width: lineWidth.value, font: css, gap: fontSize.value * 0.4 }))
})

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
  <section class="tracks" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
    <header>
      <h2>Tracks</h2>
      <span class="muted count">{{ tracks.length }} {{ sourceLabel }}</span>
      <span v-if="reading" class="count reading" role="status">Reading {{ reading.done }} / {{ reading.total }}…</span>
      <span class="spacer" />
      <span class="actions">
        <IconButton :icon="FileMusic" label="Open files…" title="Open files: a playlist, audio files, or both" @click="fileInput?.click()" />
        <IconButton :icon="Folder" label="Open folder…" title="Open folder: read the tags of every audio file in a folder" @click="folderInput?.click()" />
        <IconButton :icon="ClipboardPaste" label="Paste playlist" :aria-expanded="pasting" @click="pasting = !pasting" />
        <IconButton v-if="source !== 'sample'" :icon="RotateCcw" label="Back to samples" @click="emit('samples')" />
      </span>
      <input ref="fileInput" type="file" :accept="ACCEPT" multiple hidden @change="onPick" />
      <input ref="folderInput" type="file" webkitdirectory hidden @change="onPick" />
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
      <textarea v-model="pasted" rows="5" placeholder="#EXTM3U&#10;#EXTINF:223,Artist - Title&#10;D:\Music\Artist\Album\01 Title.mp3" />
      <div class="paste-actions">
        <button class="primary" :disabled="!pasted.trim()" @click="importPasted">Use these tracks</button>
        <span class="muted">Stays in your browser. Share links never include playlist data.</span>
      </div>
    </div>

    <ol class="rows" :style="{ '--row-font': font.family, '--row-size': `${fontSize}px`, '--row-weight': font.weight, '--pl-width': view.width ? `${view.width}px` : '100%' }">
      <li v-for="(t, i) in tracks" :key="t.id" :class="{ selected: i === selected }">
        <div class="row">
          <button class="out stretched playlist-text" :class="rows[i]?.state" :aria-pressed="i === selected" :title="rows[i]?.text" @click="emit('select', i)">
            <span :ref="(el) => setLine(i, el)" class="line">
              <span class="t">
                <span v-if="view.numbers" class="num">{{ numberPrefix(i) }}</span>
                <template v-if="rows[i]?.state === 'freeze'">⚠ would freeze WACUP</template>
                <template v-else-if="rows[i]?.state === 'timeout'">⚠ didn't finish</template>
                <template v-else-if="rows[i]?.state === 'heavy'">⚠ too heavy to preview</template>
                <template v-else>{{ fitted[i] || ' ' }}</template>
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
            <input type="text" :value="t.tags[key] ?? ''" @input="emit('setTag', i, key, ($event.target as HTMLInputElement).value)" />
          </label>
        </div>
      </li>
    </ol>
    <p class="drop-hint muted">
      Drop an <code>.m3u8</code> here to see your own tracks, with the audio files or their folder to read the tags. Your files stay on your computer.
      Without a playlist, your browser only gives the page file names, not full paths, so <code>%filename%</code> and <code>%folder%</code> start at the folder you picked.
    </p>
  </section>
</template>

<style scoped>
.tracks {
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
.rows {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
}
li {
  position: relative;
  border-top: 1px solid var(--border);
  padding: 4px 6px;
  border-left: 3px solid transparent;
  cursor: pointer;
}
li:hover {
  background: rgba(var(--tint-rgb), 0.25);
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
  background: rgba(var(--tint-rgb), 0.35);
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
  color: var(--error);
  font-family: var(--sans);
}
.out.error {
  color: var(--error);
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
  color: var(--warning);
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
