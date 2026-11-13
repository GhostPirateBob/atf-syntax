<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { ChefHat, Library, Pencil, Trash } from '@lucide/vue'
import { FIELDS, FUNCTIONS } from '@/core'
import { inlineMarkdown } from '@/lib/markdown'
import { RECIPES, recipeGroups, type Recipe } from '@/lib/recipes'
import { browserStorage, renameSaved, savedFormats, updateSaved, type SavedFormat } from '@/lib/saved'
import { isExpanded, openOnly, readCollapsed, sectionFor, toggleSection, writeCollapsed } from '@/lib/collapsed'
import { toFormat } from '@/lib/document'
import { NARROW, reducedMotion, useMedia } from '@/lib/media'
import { vTip } from '@/lib/tooltip'
import { yieldToMain } from '@/lib/timing'
import HighlightedFormat from './HighlightedFormat.vue'
import SidebarSection from './SidebarSection.vue'

const emit = defineEmits<{ insert: [text: string]; load: [recipe: Recipe]; loadSaved: [saved: SavedFormat]; delete: [saved: SavedFormat]; close: [] }>()

const tab = ref<'reference' | 'recipes'>('recipes')
/** Phones: the tabs are icons, named by aria-label and the tooltip. */
const narrow = useMedia(NARROW)
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
// Keys: recipes:saved, recipes:<group>, reference:syntax|fields|functions. Each tab's sections are an
// accordion: opening one closes the others (Saved, the visitor's own list, stays independent). On a
// first visit only the first of each is open. Collapsed lists aren't rendered (see SidebarSection),
// which matters: the sidebar was two thirds of the page's elements. The state is remembered.
const store = browserStorage()
const groups = recipeGroups(RECIPES)
const RECIPE_KEYS = groups.map(([g]) => `recipes:${g}`)
const REFERENCE_KEYS = ['reference:syntax', 'reference:fields', 'reference:functions']
const siblingsOf = (key: string) => (key.startsWith('reference:') ? REFERENCE_KEYS : RECIPE_KEYS.includes(key) ? RECIPE_KEYS : [key])
const DEFAULT_COLLAPSED = [...RECIPE_KEYS.slice(1), ...REFERENCE_KEYS.slice(1)]
const collapsed = shallowRef<ReadonlySet<string>>(readCollapsed(store, DEFAULT_COLLAPSED))
/** The section just expanded, for ~300 ms, so its items animate in (not on load or tab switches). */
const entering = ref<string | null>(null)
let enterTimer: ReturnType<typeof setTimeout> | undefined
/** While the Reference filter has text, its sections all show, so every match is visible. */
const filtering = (key: string) => key.startsWith('reference:') && q.value !== ''
const expanded = (key: string) => isExpanded(collapsed.value, key, filtering(key))
const sectionId = (key: string) => `sb-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
async function toggle(key: string) {
  if (filtering(key)) return
  const opening = !expanded(key)
  collapsed.value = opening ? openOnly(collapsed.value, key, siblingsOf(key)) : toggleSection(collapsed.value, key)
  writeCollapsed(store, collapsed.value)
  clearTimeout(enterTimer)
  entering.value = opening ? key : null
  if (!opening) return
  enterTimer = setTimeout(() => (entering.value = null), 300)
  // Bring the opened section's heading to the top of the sidebar, so its list shows below it (a
  // section above may also just have closed and moved it). Only the sidebar's own scroller moves,
  // never the page, as scrollIntoView would.
  await nextTick()
  const section = document.getElementById(`${sectionId(key)}-btn`)?.closest('section')
  const scroller = section?.closest<HTMLElement>('.scroll')
  if (!section || !scroller) return
  const pad = parseFloat(getComputedStyle(scroller).paddingTop) || 0
  const top = scroller.scrollTop + section.getBoundingClientRect().top - scroller.getBoundingClientRect().top - pad
  scroller.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' })
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

// ---- staged start ----------------------------------------------------------------------------------
// The lists are most of the page's DOM: they render after the first paint (one frame, then a yield),
// so the editor and the preview show first.
const ready = ref(false)
let markReady: () => void = () => {}
const untilReady = new Promise<void>((resolve) => (markReady = resolve))
onMounted(() =>
  requestAnimationFrame(async () => {
    await yieldToMain()
    ready.value = true
    await nextTick()
    markReady()
  }),
)

// ---- jumping to an entry from the search ---------------------------------------------------------
const root = ref<HTMLElement>()
/**
 * Shows an entry (`recipe:<title>`, `saved:<id>`, `fn-<name>` or `field-<name>`): switches tab,
 * clears the filter, scrolls it into view, focuses it and flashes an outline. False if not listed.
 */
async function reveal(which: 'recipes' | 'reference', id: string): Promise<boolean> {
  await untilReady
  tab.value = which
  query.value = ''
  // A target in a collapsed section: open it (closing its siblings, and remembering that) before
  // scrolling to it. Its list renders on the nextTick below.
  const key = sectionFor(id, RECIPES)
  if (key && !expanded(key)) {
    collapsed.value = openOnly(collapsed.value, key, siblingsOf(key))
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
</script>

<template>
  <aside ref="root" class="sidebar">
    <header>
      <button v-tip="narrow ? 'Recipes' : undefined" class="tab" :class="{ active: tab === 'recipes' }" :aria-label="narrow ? 'Recipes' : undefined" @click="tab = 'recipes'">
        <ChefHat :size="14" aria-hidden="true" /><span class="tab-label">Recipes</span>
      </button>
      <button v-tip="narrow ? 'Reference' : undefined" class="tab" :class="{ active: tab === 'reference' }" :aria-label="narrow ? 'Reference' : undefined" @click="tab = 'reference'">
        <Library :size="14" aria-hidden="true" /><span class="tab-label">Reference</span>
      </button>
      <span class="spacer" />
      <button class="close" aria-label="Close sidebar" @click="emit('close')">✕</button>
    </header>

    <!-- The lists render just after the first paint (see `ready`); the header shows at once. -->
    <div v-if="!ready" class="scroll" />
    <div v-else-if="tab === 'recipes'" class="scroll">
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
              <button v-tip="'Rename'" class="mini" :aria-label="`Rename ${s.name}`" @click="startRename(s)"><Pencil :size="14" aria-hidden="true" /></button>
              <button v-tip="'Delete'" class="mini" :aria-label="`Delete ${s.name}`" @click="emit('delete', s)"><Trash :size="14" aria-hidden="true" /></button>
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
  background: var(--chrome-bg);
  /* Secondary text readable on the raised chrome (see --muted-raised in style.css). */
  --muted: var(--muted-raised);
  --dim: var(--muted-raised);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
header {
  display: flex;
  gap: 4px;
  padding: 8px 20px 8px 8px;
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
/* The tabs: an icon before the word (box-tab style); on phones the icon alone, at least 32 px. */
.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  line-height: 1;
  min-height: 32px;
}
.tab svg {
  flex: none;
}
@media (max-width: 640px) {
  .tab {
    justify-content: center;
    min-width: 34px;
    padding: 0;
  }
  .tab-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
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
/* List items hover instantly (see the motion rule in style.css): the card's colour changes to the
   35 % tint over the card, as a solid colour, so sweeping the pointer down the list repaints one
   card at a time with no layer to promote per card. Paint containment keeps that repaint inside. */
.recipe,
.item {
  position: relative;
  contain: paint;
}
/* (Through .sb-card, so it outranks the card's resting colour in SidebarSection.vue.) */
.sb-card > .recipe:hover,
.sb-card > .item:hover,
.sb-card > .saved-item > .recipe:hover {
  background-color: color-mix(in srgb, rgb(var(--tint-rgb)) var(--sb-hover-mix), var(--sb-list-bg));
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
/* Square, but for the card's outer corners (SidebarSection), which its button follows. */
.saved-item {
  position: relative;
}
.saved-item .recipe {
  border-radius: inherit;
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
  border-radius: inherit;
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
