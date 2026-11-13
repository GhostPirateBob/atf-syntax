<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue'
import { Pencil, Trash } from '@lucide/vue'
import { FIELDS, FUNCTIONS } from '@/core'
import { inlineMarkdown } from '@/lib/markdown'
import { RECIPES, type Recipe } from '@/lib/recipes'
import { browserStorage, renameSaved, savedFormats, updateSaved, type SavedFormat } from '@/lib/saved'
import { expandSection, isExpanded, readCollapsed, sectionFor, toggleSection, writeCollapsed } from '@/lib/collapsed'
import { toFormat } from '@/lib/document'
import { reducedMotion } from '@/lib/media'
import HighlightedFormat from './HighlightedFormat.vue'
import SidebarSection from './SidebarSection.vue'

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
// ---- collapsible sections --------------------------------------------------------------------
// Keys: recipes:saved, recipes:<group>, reference:syntax|fields|functions. All expanded by default.
const store = browserStorage()
const collapsed = shallowRef<ReadonlySet<string>>(readCollapsed(store))
/** The section just expanded, for ~300 ms, so its items animate in (not on load or tab switches). */
const entering = ref<string | null>(null)
let enterTimer: ReturnType<typeof setTimeout> | undefined
/** While the Reference filter has text, its sections all show, so every match is visible. */
const filtering = (key: string) => key.startsWith('reference:') && q.value !== ''
const expanded = (key: string) => isExpanded(collapsed.value, key, filtering(key))
const sectionId = (key: string) => `sb-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
function toggle(key: string) {
  if (filtering(key)) return
  const opening = !expanded(key)
  collapsed.value = toggleSection(collapsed.value, key)
  writeCollapsed(store, collapsed.value)
  clearTimeout(enterTimer)
  entering.value = opening ? key : null
  if (opening) enterTimer = setTimeout(() => (entering.value = null), 300)
}

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
  // A target in a collapsed section: expand it (and remember that) before scrolling to it.
  const key = sectionFor(id, RECIPES)
  if (key && !expanded(key)) {
    collapsed.value = expandSection(collapsed.value, key)
    writeCollapsed(store, collapsed.value)
  }
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
      <SidebarSection
        v-if="savedFormats.length"
        :id="sectionId('recipes:saved')"
        class="saved"
        title="Saved"
        :count="savedFormats.length"
        :expanded="expanded('recipes:saved')"
        :entering="entering === 'recipes:saved'"
        @toggle="toggle('recipes:saved')"
      >
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
      </SidebarSection>
      <SidebarSection
        v-for="[group, recipes] in groups"
        :id="sectionId(`recipes:${group}`)"
        :key="group"
        :title="group"
        :count="recipes.length"
        :expanded="expanded(`recipes:${group}`)"
        :entering="entering === `recipes:${group}`"
        @toggle="toggle(`recipes:${group}`)"
      >
        <button v-for="r in recipes" :key="r.title" class="recipe" :data-search-id="`recipe:${r.title}`" @click="emit('load', r)">
          <strong>{{ r.title }}</strong>
          <span class="note">{{ r.note }}</span>
          <HighlightedFormat :format="r.format" class="preview" />
        </button>
      </SidebarSection>
    </div>

    <div v-else class="scroll">
      <input v-model="query" type="search" placeholder="Search fields and functions…" class="search" />
      <SidebarSection
        v-if="!q"
        :id="sectionId('reference:syntax')"
        title="Syntax"
        :expanded="expanded('reference:syntax')"
        :entering="entering === 'reference:syntax'"
        @toggle="toggle('reference:syntax')"
      >
        <dl>
          <template v-for="s in SYNTAX" :key="s.code">
            <dt><HighlightedFormat :format="s.code" /></dt>
            <dd v-html="inlineMarkdown(s.doc)" />
          </template>
        </dl>
      </SidebarSection>
      <SidebarSection
        :id="sectionId('reference:fields')"
        title="Fields"
        :count="fields.length"
        :expanded="expanded('reference:fields')"
        :entering="entering === 'reference:fields'"
        @toggle="toggle('reference:fields')"
      >
        <button v-for="f in fields" :key="f.name" class="item" :data-search-id="`field-${f.name}`" :title="`Insert %${f.name}%`" @click="emit('insert', `%${f.name}%`)">
          <span class="name tok-field">%{{ f.name }}%</span>
          <span class="doc" v-html="inlineMarkdown(f.doc)" />
        </button>
      </SidebarSection>
      <SidebarSection
        :id="sectionId('reference:functions')"
        title="Functions"
        :count="functions.length"
        :expanded="expanded('reference:functions')"
        :entering="entering === 'reference:functions'"
        @toggle="toggle('reference:functions')"
      >
        <button v-for="f in functions" :key="f.name" class="item" :data-search-id="`fn-${f.name}`" :title="`Insert $${f.name}(`" @click="emit('insert', `$${f.name}(`)">
          <span class="name"><span class="tok-fn">${{ f.name }}</span><span class="sig">{{ f.sig }}</span></span>
          <span class="doc" v-html="inlineMarkdown(f.doc)" />
        </button>
      </SidebarSection>
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
/* The hover tint is an overlay under the text that fades in (opacity only). */
.recipe,
.item {
  position: relative;
  isolation: isolate;
}
.recipe::before,
.item::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: rgba(var(--tint-rgb), 0.35);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}
.recipe:hover::before,
.item:hover::before {
  opacity: 1;
}
.recipe:hover,
.item:hover {
  border-top-color: var(--border);
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
  margin-bottom: 10px;
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
  margin: 0 0 4px;
  padding: 0 8px;
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
/* A brief outline and tint on the entry the search jumped to: an overlay whose opacity fades out
   over about a second (a one-shot pulse, so a keyframe animation). The class comes off at 1.6 s. */
.flash {
  position: relative;
}
.flash::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  box-shadow: inset 0 0 0 2px var(--gold);
  background: rgba(190, 146, 8, 0.18);
  opacity: 0;
  pointer-events: none;
  animation: flash 1.1s ease-out;
}
@keyframes flash {
  from {
    opacity: 1;
  }
}
</style>
