<script setup lang="ts">
import { computed, ref } from 'vue'
import { EDITABLE_TAGS, type Track } from '@/lib/tracks'
import { parseM3u } from '@/lib/m3u'
import { AUDIO_EXTENSIONS, PLAYLIST_EXTENSIONS } from '@/lib/audio'
import { filesFromDrop, filesFromInput, sortPicked, type Picked } from '@/lib/pick'
import { fontStack, fontWeight, measureText } from '@/lib/measure'
import type { ViewSettings } from './DisplaySettings.vue'

export interface Row {
  label: string
  /** Output after WACUP's display habits, or '' while pending. */
  text: string
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
  numbers: [on: boolean]
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

const fontCss = computed(() => fontStack(props.view.font))
const weight = computed(() => fontWeight(props.view.font))
// Web fonts arrive after the country check (or never, in the GDPR area), so re-measure each time a
// font finishes loading rather than once.
const fontsLoaded = ref(0)
document.fonts?.addEventListener('loadingdone', () => fontsLoaded.value++)
const fontSize = computed(() => Math.min(40, Math.max(8, props.view.fontSize || 15)))
const numberPrefix = (i: number) => (props.view.numbers ? `${i + 1}. ` : '')
const overflow = computed(() => {
  if (!props.view.width) return props.rows.map(() => false)
  void fontsLoaded.value
  const font = `${weight.value} ${fontSize.value}px ${fontCss.value}`
  // WACUP draws the number in the same row, so it counts toward the width.
  return props.rows.map((r, i) => measureText(numberPrefix(i) + r.text, font) > props.view.width)
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
      <label class="toggle" title="WACUP's &quot;1. &quot; playlist numbers in front of each row">
        <input type="checkbox" :checked="view.numbers" @change="emit('numbers', ($event.target as HTMLInputElement).checked)" /> Playlist numbers
      </label>
      <button title="A playlist, audio files, or both" @click="fileInput?.click()">Open files…</button>
      <button title="Read the tags of every audio file in a folder" @click="folderInput?.click()">Open folder…</button>
      <button @click="pasting = !pasting">Paste playlist</button>
      <button v-if="source !== 'sample'" @click="emit('samples')">Back to samples</button>
      <input ref="fileInput" type="file" :accept="ACCEPT" multiple hidden @change="onPick" />
      <input ref="folderInput" type="file" webkitdirectory hidden @change="onPick" />
    </header>

    <div v-if="pasting" class="paste">
      <textarea v-model="pasted" rows="5" placeholder="#EXTM3U&#10;#EXTINF:223,Artist - Title&#10;D:\Music\Artist\Album\01 Title.mp3" />
      <div class="paste-actions">
        <button class="primary" :disabled="!pasted.trim()" @click="importPasted">Use these tracks</button>
        <span class="muted">Stays in your browser. Share links never include playlist data.</span>
      </div>
    </div>

    <ol class="rows" :style="{ '--row-font': fontCss, '--row-size': `${fontSize}px`, '--row-weight': weight }">
      <li v-for="(t, i) in tracks" :key="t.id" :class="{ selected: i === selected, over: overflow[i] }">
        <div class="row">
          <button class="out stretched" :class="rows[i]?.state" :aria-pressed="i === selected" :title="rows[i]?.text" @click="emit('select', i)">
            <span v-if="view.numbers" class="num">{{ numberPrefix(i) }}</span>
            <template v-if="rows[i]?.state === 'freeze'">⚠ would freeze WACUP</template>
            <template v-else-if="rows[i]?.state === 'timeout'">⚠ didn't finish</template>
            <template v-else-if="rows[i]?.state === 'heavy'">⚠ too heavy to preview</template>
            <template v-else>{{ rows[i]?.text || ' ' }}</template>
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
    <div v-if="view.width" class="width-note muted">Rows marked ▌ are wider than {{ view.width }} px in this font.</div>
    <p class="drop-hint muted">
      Drop an <code>.m3u8</code> here to see your own tracks. A playlist only has paths and lengths, so fields like <code>%artist%</code> stay empty.
      Drop the audio files too, or a folder, to read their tags. Your files stay on your computer.
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
  background: rgba(7, 54, 66, 0.25);
}
/* Stretched link: the select button's ::after covers the whole row, so a click anywhere selects
   the track, while keyboard and screen-reader users still get one real button per row. */
.stretched::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
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
  background: rgba(7, 54, 66, 0.35);
}
li.over {
  box-shadow: inset -4px 0 0 var(--orange);
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
  overflow: hidden;
  text-overflow: ellipsis;
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
.width-note,
.drop-hint {
  font-size: 0.8rem;
  margin: 8px 0 0;
}
</style>
