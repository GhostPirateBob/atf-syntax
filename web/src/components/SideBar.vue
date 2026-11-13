<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Pencil, Trash } from '@lucide/vue'
import { FIELDS, FUNCTIONS } from '@/core'
import { inlineMarkdown } from '@/lib/markdown'
import { RECIPES, type Recipe } from '@/lib/recipes'
import { renameSaved, savedFormats, updateSaved, type SavedFormat } from '@/lib/saved'
import { toFormat } from '@/lib/document'
import { reducedMotion } from '@/lib/media'
import HighlightedFormat from './HighlightedFormat.vue'

const emit = defineEmits<{ insert: [text: string]; load: [recipe: Recipe]; loadSaved: [saved: SavedFormat]; delete: [saved: SavedFormat]; close: [] }>()

const tab = ref<'reference' | 'recipes'>('recipes')
const query = ref('')

const SYNTAX = [
  { code: '%artist%', doc: 'A tag field. Empty if the track has no such tag.' },
  { code: '$upper(%artist%)', doc: 'A function call. Arguments are worked out first, then the function runs.' },
  { code: '[ … ]', doc: 'Shown only if a `%field%` inside has a value: `[%artist% - ]%title%`.' },
  { code: "'text'", doc: "Literal text: use it for `, ( ) [ ] % $` in the output. `''` outputs one `'`." },
  { code: '%% $$', doc: 'A literal `%` or `$`.' },
  { code: '# …', doc: 'Playground only: a line starting with `#` is a comment. Line breaks are ignored, like in `.atf` files.' },
]

const q = computed(() => query.value.trim().toLowerCase())
const fields = computed(() => FIELDS.filter((f) => !q.value || f.name.includes(q.value) || f.doc.toLowerCase().includes(q.value)))
const functions = computed(() =>
  FUNCTIONS.filter((f) => !q.value || f.name.includes(q.value.replace(/^\$/, '')) || f.doc.toLowerCase().includes(q.value)),
)
// ---- saved formats --------------------------------------------------------------------------
const renaming = ref<string | null>(null)
const renameText = ref('')
async function startRename(s: SavedFormat) {
  renaming.value = s.id
  renameText.value = s.name
  await nextTick()
  const input = root.value?.querySelector<HTMLInputElement>('.rename input')
  input?.focus()
  input?.select()
}
async function finishRename(s: SavedFormat) {
  if (renameText.value.trim()) updateSaved((list) => renameSaved(list, s.id, renameText.value))
  await cancelRename(s)
}
async function cancelRename(s: SavedFormat) {
  renaming.value = null
  await nextTick()
  root.value?.querySelector<HTMLElement>(`[data-search-id="${CSS.escape(`saved:${s.id}`)}"] .recipe`)?.focus()
}
const flatFormat = (doc: string) => toFormat(doc).format

// ---- jumping to an entry from the search ---------------------------------------------------------
const root = ref<HTMLElement>()
/**
 * Shows an entry (`recipe:<title>`, `saved:<id>`, `fn-<name>` or `field-<name>`): switches tab,
 * clears the filter, scrolls it into view, focuses it and flashes an outline. False if not listed.
 */
async function reveal(which: 'recipes' | 'reference', id: string): Promise<boolean> {
  tab.value = which
  query.value = ''
  await nextTick()
  const el = root.value?.querySelector<HTMLElement>(`[data-search-id="${CSS.escape(id)}"]`)
  if (!el) return false
  el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' })
  ;(el.matches('button') ? el : el.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true })
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
  setTimeout(() => el.classList.remove('flash'), 1600)
  return true
}
defineExpose({ reveal })

const groups = computed(() => {
  const out = new Map<string, Recipe[]>()
  for (const r of RECIPES) out.set(r.group, [...(out.get(r.group) ?? []), r])
  return [...out]
})
</script>

<template>
  <aside ref="root" class="sidebar">
    <header>
      <button :class="{ active: tab === 'recipes' }" @click="tab = 'recipes'">Recipes</button>
      <button :class="{ active: tab === 'reference' }" @click="tab = 'reference'">Reference</button>
      <span class="spacer" />
      <button class="close" aria-label="Close sidebar" @click="emit('close')">✕</button>
    </header>

    <div v-if="tab === 'recipes'" class="scroll">
      <section v-if="savedFormats.length" class="saved" aria-labelledby="saved-heading">
        <h3 id="saved-heading">Saved</h3>
        <p class="saved-note muted">Saved in this browser only.</p>
        <div v-for="s in savedFormats" :key="s.id" class="saved-item" :data-search-id="`saved:${s.id}`">
          <form v-if="renaming === s.id" class="rename" @submit.prevent="finishRename(s)" @keydown.esc.stop.prevent="cancelRename(s)">
            <input v-model="renameText" type="text" aria-label="New name" maxlength="80" />
            <button type="submit" class="primary">Rename</button>
            <button type="button" @click="cancelRename(s)">Cancel</button>
          </form>
          <template v-else>
            <button class="recipe" @click="emit('loadSaved', s)">
              <strong>{{ s.name }}</strong>
              <HighlightedFormat :format="flatFormat(s.doc)" class="preview" />
            </button>
            <span class="saved-actions">
              <button class="mini" :aria-label="`Rename ${s.name}`" title="Rename" @click="startRename(s)"><Pencil :size="14" aria-hidden="true" /></button>
              <button class="mini" :aria-label="`Delete ${s.name}`" title="Delete" @click="emit('delete', s)"><Trash :size="14" aria-hidden="true" /></button>
            </span>
          </template>
        </div>
      </section>
      <section v-for="[group, recipes] in groups" :key="group">
        <h3>{{ group }}</h3>
        <button v-for="r in recipes" :key="r.title" class="recipe" :data-search-id="`recipe:${r.title}`" @click="emit('load', r)">
          <strong>{{ r.title }}</strong>
          <span class="note">{{ r.note }}</span>
          <HighlightedFormat :format="r.format" class="preview" />
        </button>
      </section>
    </div>

    <div v-else class="scroll">
      <input v-model="query" type="search" placeholder="Search fields and functions…" class="search" />
      <section v-if="!q">
        <h3>Syntax</h3>
        <dl>
          <template v-for="s in SYNTAX" :key="s.code">
            <dt><HighlightedFormat :format="s.code" /></dt>
            <dd v-html="inlineMarkdown(s.doc)" />
          </template>
        </dl>
      </section>
      <section>
        <h3>Fields <span class="muted">({{ fields.length }})</span></h3>
        <button v-for="f in fields" :key="f.name" class="item" :data-search-id="`field-${f.name}`" :title="`Insert %${f.name}%`" @click="emit('insert', `%${f.name}%`)">
          <span class="name tok-field">%{{ f.name }}%</span>
          <span class="doc" v-html="inlineMarkdown(f.doc)" />
        </button>
      </section>
      <section>
        <h3>Functions <span class="muted">({{ functions.length }})</span></h3>
        <button v-for="f in functions" :key="f.name" class="item" :data-search-id="`fn-${f.name}`" :title="`Insert $${f.name}(`" @click="emit('insert', `$${f.name}(`)">
          <span class="name"><span class="tok-fn">${{ f.name }}</span><span class="sig">{{ f.sig }}</span></span>
          <span class="doc" v-html="inlineMarkdown(f.doc)" />
        </button>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  background: var(--sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
header {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}
header button {
  background: none;
  border-color: transparent;
}
header button.active {
  border-color: var(--teal);
  color: var(--bright);
}
.spacer {
  flex: 1;
}
.scroll {
  overflow-y: auto;
  padding: 10px 12px 24px;
  flex: 1;
}
/* The list starts right at its first heading. */
.scroll > section:first-child > h3 {
  margin-top: 4px;
}
h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--dim);
  margin: 16px 0 6px;
}
.recipe,
.item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 0;
  padding: 9px 8px;
}
/* A rule between entries, like the parts table and track list; none under a heading. */
.recipe + .recipe,
.item + .item,
.saved-item + .saved-item {
  border-top: 1px solid var(--border);
}
.recipe:hover,
.item:hover {
  border-top-color: var(--border);
  background: rgba(var(--tint-rgb), 0.35);
}
.recipe strong {
  color: var(--bright);
  font-weight: 600;
}
.note {
  font-size: 0.83rem;
  color: var(--text);
}
.preview {
  font-size: 0.78rem;
  margin-top: 2px;
}
.search {
  width: 100%;
}
dl {
  margin: 0;
  font-size: 0.85rem;
}
dt {
  font-family: var(--mono);
  margin-top: 6px;
}
dd {
  margin: 0 0 0 12px;
}
.name {
  font-family: var(--mono);
  font-size: 0.9rem;
}
.sig {
  color: var(--dim);
}
.doc {
  font-size: 0.82rem;
  color: var(--text);
}
.saved-note {
  font-size: 0.78rem;
  margin: -4px 0 6px;
}
.saved-item {
  position: relative;
  border-radius: 4px;
}
.saved-item .recipe {
  padding-right: 64px;
}
.saved-actions {
  position: absolute;
  top: 5px;
  right: 6px;
  display: flex;
  gap: 2px;
}
.mini {
  display: grid;
  place-items: center;
  width: 26px;
  height: 24px;
  padding: 0;
  background: none;
  border-color: transparent;
  color: var(--muted);
}
.mini:hover,
.mini:focus-visible {
  border-color: var(--teal);
  color: var(--bright);
}
.rename {
  display: flex;
  gap: 4px;
  padding: 4px 0 8px;
}
.rename input {
  flex: 1;
  min-width: 0;
}
.recipe:focus-visible,
.item:focus-visible,
header button:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: -2px;
}
/* A brief outline and tint on the entry the search jumped to, fading out over about a second. */
.flash {
  animation: flash 1.1s ease-out;
}
@keyframes flash {
  0% {
    outline: 2px solid var(--gold);
    outline-offset: -2px;
    background: rgba(190, 146, 8, 0.18);
  }
  100% {
    outline: 2px solid transparent;
    outline-offset: -2px;
    background: transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .flash {
    animation: none;
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }
}
</style>
