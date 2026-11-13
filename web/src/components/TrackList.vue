<script setup lang="ts">
import { computed, ref } from 'vue'
import { EDITABLE_TAGS, type Track } from '@/lib/tracks'
import { parseM3u, type PlaylistEntry } from '@/lib/m3u'
import { fontStack, fontWeight, measureText } from '@/lib/measure'
import type { ViewSettings } from './DisplaySettings.vue'

export interface Row {
  label: string
  /** Output after WACUP's display habits, or '' while pending. */
  text: string
  state: 'ok' | 'freeze' | 'error' | 'timeout' | 'pending'
  unsure: boolean
  cached?: string
}

const props = defineProps<{ tracks: Track[]; rows: Row[]; selected: number; view: ViewSettings; source: 'sample' | 'playlist' }>()
const emit = defineEmits<{
  select: [index: number]
  setTag: [index: number, key: string, value: string]
  import: [entries: PlaylistEntry[]]
  samples: []
}>()

const editing = ref<number | null>(null)
const pasting = ref(false)
const pasted = ref('')
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()

const fontCss = computed(() => fontStack(props.view.font))
const weight = computed(() => fontWeight(props.view.font))
// Web fonts arrive after the country check (or never, in the GDPR area), so re-measure each time a
// font finishes loading rather than once.
const fontsLoaded = ref(0)
document.fonts?.addEventListener('loadingdone', () => fontsLoaded.value++)
const fontSize = computed(() => Math.min(40, Math.max(8, props.view.fontSize || 15)))
const overflow = computed(() => {
  if (!props.view.width) return props.rows.map(() => false)
  void fontsLoaded.value
  const font = `${weight.value} ${fontSize.value}px ${fontCss.value}`
  return props.rows.map((r) => measureText(r.text, font) > props.view.width)
})

function readFile(file: File) {
  file.text().then((text) => emit('import', parseM3u(text)))
}
function onDrop(e: DragEvent) {
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) readFile(file)
}
function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) readFile(file)
  if (fileInput.value) fileInput.value.value = ''
}
function importPasted() {
  emit('import', parseM3u(pasted.value))
  pasted.value = ''
  pasting.value = false
}
</script>

<template>
  <section class="tracks" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
    <header>
      <h2>Tracks</h2>
      <span class="muted count">{{ tracks.length }} {{ source === 'playlist' ? 'from your playlist' : 'samples' }}</span>
      <span class="spacer" />
      <button @click="fileInput?.click()">Open playlist…</button>
      <button @click="pasting = !pasting">Paste playlist</button>
      <button v-if="source === 'playlist'" @click="emit('samples')">Back to samples</button>
      <input ref="fileInput" type="file" accept=".m3u,.m3u8,.txt" hidden @change="onPick" />
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
        <div class="row" @click="emit('select', i)">
          <span class="out" :class="rows[i]?.state">
            <template v-if="rows[i]?.state === 'freeze'">⚠ would freeze WACUP</template>
            <template v-else-if="rows[i]?.state === 'timeout'">⚠ didn't finish</template>
            <template v-else>{{ rows[i]?.text || ' ' }}</template>
          </span>
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
    <p class="drop-hint muted">Drop an <code>.m3u8</code> here to see your own tracks. A playlist has paths and lengths, not tags, so fields like <code>%artist%</code> stay empty.</p>
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
  border-top: 1px solid var(--border);
  padding: 4px 6px;
  border-left: 3px solid transparent;
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
  cursor: pointer;
}
.out {
  flex: 1;
  font-family: var(--row-font);
  font-size: var(--row-size);
  font-weight: var(--row-weight);
  color: var(--bright);
  white-space: pre;
  overflow-x: auto;
  scrollbar-width: none;
}
.out.freeze,
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
