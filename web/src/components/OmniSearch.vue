<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef, watch } from 'vue'
import { History, Search, X } from '@lucide/vue'
import throttle from 'lodash-es/throttle'
import { frames, whenIdle } from '@/lib/timing'
import { vTip } from '@/lib/tooltip'
import { browserStorage, savedFormats } from '@/lib/saved'
import {
  addRecent,
  groupHits,
  highlight,
  KIND_LABELS,
  parseRecent,
  RECENT_KEY,
  routeFor,
  snippet,
  type Hit,
  type PlaygroundAction,
  type RecentItem,
  type SearchDoc,
  type SearchPage,
} from '@/lib/search'
import type { Searcher } from '@/lib/searchCorpus'

/**
 * The header's search over recipes, saved formats, functions, fields, lint rules, settings and
 * the wiki: an ARIA combobox with a grouped listbox. MiniSearch and the corpus load on first open.
 * On narrow screens it is a search icon that opens a full-width overlay.
 */
const props = withDefaults(defineProps<{ page: SearchPage; refListed?: (target: string) => boolean }>(), { refListed: () => true })
const emit = defineEmits<{ action: [action: PlaygroundAction] }>()

const open = ref(false)
const query = ref('')
const active = ref(-1)
const loading = ref(false)
const searcher = shallowRef<Searcher>()
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const iconButton = ref<HTMLButtonElement>()
/** Narrow screens, where the field is a search icon (keep in step with the @media rule in the styles). */
const ICON_ONLY = '(max-width: 760px)'
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const hint = isMac ? '⌘ K' : 'Ctrl K'

// ---- recent searches and picks (this browser only) ----------------------------------------------
const store = browserStorage()
function loadRecent(): RecentItem[] {
  try {
    return parseRecent(store?.getItem(RECENT_KEY) ?? null)
  } catch {
    return []
  }
}
const recent = ref<RecentItem[]>(loadRecent())
function remember(item: RecentItem) {
  recent.value = addRecent(recent.value, item)
  try {
    store?.setItem(RECENT_KEY, JSON.stringify(recent.value))
  } catch {
    /* storage blocked: recents last until the page closes */
  }
}

// ---- the index: prebuilt, restored when the page is idle (or on first use) ----------------------
let loadingPromise: Promise<void> | undefined
/** Loads the corpus chunk and restores its index. `quiet`: a warm-up, so no "Loading" message. */
function ensureIndex(quiet = false): Promise<void> {
  if (searcher.value) return Promise.resolve()
  if (!quiet) loading.value = true
  loadingPromise ??= (async () => {
    try {
      const { makeSearcher } = await import('@/lib/searchCorpus')
      searcher.value = await makeSearcher(savedFormats.value)
    } finally {
      loading.value = false
      loadingPromise = undefined
    }
  })()
  return loadingPromise
}
/** Warms the index ahead of the first search (pointer over, or focus on, the search box). */
const warm = () => void ensureIndex(true).catch(() => {})
// Ready before the first open: fetched and restored once the page has settled (after the editor).
let cancelWarm: (() => void) | undefined
onMounted(() => (cancelWarm = whenIdle(warm, 4000)))
onBeforeUnmount(() => cancelWarm?.())
watch(
  savedFormats,
  () => {
    searcher.value?.setSaved(savedFormats.value)
    triggerRef(searcher)
  },
  { deep: true },
)

// ---- options shown --------------------------------------------------------------------------
interface Option {
  id: string
  title: string
  sig: string
  body: string
  mono: boolean
  icon?: 'history'
  kindLabel?: string
  pick: () => void
}
interface OptionGroup {
  key: string
  label: string
  options: Option[]
}

const MONO = new Set(['function', 'field', 'rule', 'setting'])
const q = computed(() => query.value.trim())
const hits = computed<Hit[]>(() => (searcher.value && q.value ? searcher.value.search(q.value) : []))

const groups = computed<OptionGroup[]>(() => {
  if (q.value) {
    return groupHits(hits.value).map((g) => ({
      key: g.kind,
      label: g.label,
      options: g.hits.map((h) => ({
        id: `omni-opt-${h.doc.id}`,
        title: highlight(h.doc.title, h.terms),
        sig: h.doc.sig ? highlight(snippet(h.doc.sig, h.terms, 90), h.terms) : '',
        body: highlight(snippet(h.doc.body, h.terms), h.terms),
        mono: MONO.has(h.doc.kind),
        pick: () => go(h.doc),
      })),
    }))
  }
  if (!recent.value.length) return []
  return [
    {
      key: 'recent',
      label: 'Recent',
      options: recent.value.map((r, i) =>
        r.type === 'query'
          ? { id: `omni-recent-${i}`, title: highlight(r.text, []), sig: '', body: '', mono: false, icon: 'history' as const, pick: () => setQuery(r.text) }
          : {
              id: `omni-recent-${i}`,
              title: highlight(r.title, []),
              sig: '',
              body: '',
              mono: MONO.has(r.kind),
              kindLabel: KIND_LABELS[r.kind],
              pick: () => goById(r.id),
            },
      ),
    },
  ]
})
const flat = computed(() => groups.value.flatMap((g) => g.options))
const activeId = computed(() => flat.value[active.value]?.id)
const countText = computed(() => {
  if (!open.value || !q.value || loading.value) return ''
  const n = flat.value.length
  return n ? `${n} result${n === 1 ? '' : 's'}. Use Up and Down to choose, Enter to open.` : 'No results.'
})

/** The results' scrolling box. */
const pop = ref<HTMLElement>()
/** Set by Up and Down: only a move by key needs the active option scrolled into view. */
let keyMove = false
// New results start at the top: a scroll write, no layout read (scrollIntoView on every keystroke
// forced a layout each time).
watch(query, () => {
  active.value = q.value ? 0 : -1
  if (pop.value) pop.value.scrollTop = 0
})
watch(activeId, async (id) => {
  if (!keyMove) return
  keyMove = false
  await nextTick()
  if (id) document.getElementById(id)?.scrollIntoView({ block: 'nearest' })
})

// ---- open, close, keys ------------------------------------------------------------------------
async function openSearch() {
  open.value = true
  void ensureIndex()
  await nextTick()
  input.value?.focus()
}
function close(refocus = false) {
  if (!open.value) return
  open.value = false
  active.value = -1
  // The overlay hid the field: give focus back to the icon that opened it.
  // The icon only shows on narrow screens (the same query as the CSS below): no style read needed.
  if (refocus && iconButton.value && window.matchMedia(ICON_ONLY).matches) iconButton.value.focus()
}
function setQuery(text: string) {
  query.value = text
  input.value?.focus()
}

function onKeydown(e: KeyboardEvent) {
  const n = flat.value.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') keyMove = true
  if (e.key === 'ArrowDown') {
    if (!open.value) void openSearch()
    else if (n) active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp') {
    if (n) active.value = active.value <= 0 ? n - 1 : active.value - 1
  } else if (e.key === 'Enter') {
    const o = flat.value[active.value]
    if (!o) return
    o.pick()
  } else if (e.key === 'Escape') {
    if (!open.value) return
    close(true)
  } else return
  e.preventDefault()
}
function onFocusOut(e: FocusEvent) {
  const next = e.relatedTarget as Node | null
  if (next && root.value?.contains(next)) return
  // A click inside the popup moves focus nowhere for a moment; options keep focus with mousedown.prevent.
  if (!next && document.activeElement && root.value?.contains(document.activeElement)) return
  close(!next)
}

const isEditable = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable)
function onGlobalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    void openSearch()
  } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(document.activeElement)) {
    e.preventDefault()
    void openSearch()
  }
}
onMounted(() => document.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onGlobalKey))
/** The pointer over an option makes it the active one: at most once a frame, the last move always applied. */
const onOptionMove = throttle((o: (typeof flat.value)[number]) => (active.value = flat.value.indexOf(o)), frames(1), { leading: true, trailing: true })
onBeforeUnmount(() => onOptionMove.cancel())

// ---- going to a result ------------------------------------------------------------------------
function go(doc: SearchDoc) {
  if (q.value) remember({ type: 'query', text: q.value })
  remember({ type: 'pick', id: doc.id, title: doc.title, kind: doc.kind })
  query.value = ''
  close()
  input.value?.blur()
  const route = routeFor(doc, props.page, props.refListed)
  if (route.type === 'action') emit('action', route.action)
  else if (route.type === 'external') window.open(route.href, '_blank', 'noopener')
  else if (route.href.startsWith('#')) {
    // Same page: setting the hash scrolls and lights up :target. Picking the same entry again
    // doesn't change the hash, so scroll by hand.
    if (location.hash === route.href) document.getElementById(decodeURIComponent(route.href.slice(1)))?.scrollIntoView()
    else location.hash = route.href
  } else location.href = route.href
}
async function goById(id: string) {
  await ensureIndex()
  const doc = searcher.value?.byId.get(id)
  if (doc) go(doc)
}

defineExpose({ open: openSearch })
</script>

<template>
  <div ref="root" class="omni" :class="{ open }" @focusout="onFocusOut">
    <button ref="iconButton" v-tip="`Search (${hint})`" class="omni-icon" aria-label="Search" @pointerenter="warm" @focus="warm" @click="openSearch">
      <Search :size="16" aria-hidden="true" />
    </button>
    <div v-if="open" class="omni-backdrop" aria-hidden="true" @click="close(true)" />
    <div class="omni-field" @pointerenter="warm">
      <Search class="omni-lens" :size="16" aria-hidden="true" />
      <input
        ref="input"
        v-model="query"
        type="search"
        role="combobox"
        aria-label="Search recipes, functions and docs"
        aria-autocomplete="list"
        aria-controls="omni-list"
        :aria-expanded="open && flat.length > 0"
        :aria-activedescendant="open ? activeId : undefined"
        placeholder="Search recipes, functions, docs…"
        autocomplete="off"
        spellcheck="false"
        @focus="openSearch"
        @click="open || openSearch()"
        @input="open = true"
        @keydown="onKeydown"
      />
      <kbd class="omni-hint" aria-hidden="true">{{ hint }}</kbd>
      <button class="omni-close" aria-label="Close search" @click="close(true)"><X :size="18" aria-hidden="true" /></button>

      <div v-if="open" ref="pop" class="omni-pop" @mousedown.prevent>
        <p v-if="loading && q" class="omni-msg">Loading the index…</p>
        <p v-else-if="q && !flat.length" class="omni-msg">No matches for “{{ q }}”.</p>
        <p v-else-if="!q && !flat.length" class="omni-msg">Search recipes, functions, fields, lint rules, settings and the wiki. Press <kbd>/</kbd> or <kbd>{{ hint }}</kbd> from anywhere.</p>
        <div id="omni-list" role="listbox" aria-label="Search results" class="omni-list" :hidden="!flat.length">
          <div v-for="g in groups" :key="g.key" role="group" :aria-labelledby="`omni-g-${g.key}`" class="omni-group">
            <div :id="`omni-g-${g.key}`" role="presentation" class="omni-group-label">{{ g.label }}</div>
            <div
              v-for="o in g.options"
              :id="o.id"
              :key="o.id"
              role="option"
              class="omni-opt"
              :class="{ active: o.id === activeId }"
              :aria-selected="o.id === activeId"
              @mousemove="onOptionMove(o)"
              @click="o.pick()"
            >
              <span class="omni-title-line">
                <History v-if="o.icon === 'history'" :size="14" aria-hidden="true" class="omni-hist" />
                <span class="omni-title" :class="{ mono: o.mono }" v-html="o.title" />
                <span v-if="o.kindLabel" class="omni-kind">{{ o.kindLabel }}</span>
              </span>
              <span v-if="o.sig" class="omni-sig mono" v-html="o.sig" />
              <span v-if="o.body" class="omni-body" v-html="o.body" />
            </div>
          </div>
        </div>
      </div>
    </div>
    <span class="omni-live" role="status" aria-live="polite">{{ countText }}</span>
  </div>
</template>

<style scoped>
.omni {
  position: relative;
  width: 100%;
  min-width: 0;
}
.omni-icon,
.omni-close {
  display: none;
  place-items: center;
  width: 34px;
  height: 32px;
  padding: 0;
}
.omni-icon:focus-visible,
.omni-close:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 1px;
}
.omni-field {
  position: relative;
  display: flex;
  align-items: center;
}
.omni-lens {
  position: absolute;
  left: 9px;
  color: var(--muted);
  pointer-events: none;
}
.omni-field input {
  width: 100%;
  height: 32px;
  padding: 4px 64px 4px 32px;
  background: var(--input-bg);
}
input:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 0;
}
/* The browser's own clear button would sit on the hint. */
input::-webkit-search-cancel-button {
  display: none;
}
.omni-hint {
  position: absolute;
  right: 8px;
  pointer-events: none;
}
kbd {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--muted);
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0 5px;
  background: var(--panel);
  white-space: nowrap;
}
.omni.open .omni-hint {
  display: none;
}
.omni-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translate3d(-50%, 0, 0);
  width: min(600px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
  overflow-y: auto;
  background: var(--sidebar);
  border: 1px solid var(--teal);
  border-radius: 6px;
  box-shadow: 0 8px 16px var(--shadow);
  z-index: 40;
  text-align: left;
  padding: 4px 0 6px;
  /* Grows out of the search box above it (top centre) as it's inserted. */
  transform-origin: top center;
  contain: layout paint;
  transition:
    opacity 0.14s ease-out,
    transform 0.14s ease-out;
}
@starting-style {
  .omni-pop {
    opacity: 0;
    transform: translate3d(-50%, 0, 0) scale(calc(1 - 0.02 * var(--motion)));
  }
}
.omni-msg {
  margin: 0;
  padding: 10px 14px;
  font-size: 0.86rem;
  color: var(--muted);
}
.omni-group-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--dim);
  padding: 8px 14px 2px;
}
.omni-opt {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 14px 6px;
  border-left: 3px solid transparent;
  cursor: pointer;
  /* Results below the popup's fold skip layout and paint until scrolled to (a query shows up to 40);
     their size until then is about a result's. They stay in the accessibility tree. */
  content-visibility: auto;
  contain-intrinsic-size: auto 62px;
}
.omni-opt.active {
  /* The 55 % tint over the results' panel, solid. */
  background: color-mix(in srgb, rgb(var(--tint-rgb)) 55%, var(--sidebar));
  border-left-color: var(--teal);
}
.omni-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.omni-title {
  color: var(--bright);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.omni-title.mono {
  font-family: var(--mono);
  font-weight: normal;
}
.omni-hist {
  color: var(--muted);
  flex: none;
}
.omni-kind {
  margin-left: auto;
  flex: none;
  font-size: 0.72rem;
  color: var(--muted);
}
.omni-sig {
  font-size: 0.8rem;
  color: var(--dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.omni-body {
  font-size: 0.82rem;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.omni-opt :deep(mark) {
  background: rgba(190, 146, 8, 0.28);
  color: inherit;
  border-radius: 2px;
}
.omni-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.omni-backdrop {
  display: none;
}

/* Narrow screens: a search icon; opening it shows the field and results over the page. */
@media (max-width: 760px) {
  .omni {
    width: auto;
  }
  .omni-icon {
    display: grid;
  }
  .omni-field {
    display: none;
  }
  .omni.open .omni-field {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    position: fixed;
    inset: 0;
    align-content: flex-start;
    padding: 8px 12px;
    background: var(--sidebar);
    z-index: 61;
    transition: opacity 0.14s ease-out;
  }
  @starting-style {
    .omni.open .omni-field {
      opacity: 0;
    }
  }
  .omni.open .omni-lens {
    left: 21px;
    top: 16px;
  }
  .omni.open .omni-field input {
    flex: 1;
    width: auto;
    padding-right: 8px;
  }
  .omni.open .omni-close {
    display: grid;
  }
  .omni.open .omni-pop {
    position: static;
    transform: none;
    flex-basis: 100%;
    width: 100%;
    max-height: calc(100dvh - 56px);
    border: none;
    box-shadow: none;
    background: transparent;
    transition: none;
  }
  .omni.open .omni-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 60;
    transition: opacity 0.14s ease-out;
  }
  @starting-style {
    .omni.open .omni-backdrop {
      opacity: 0;
    }
  }
}
</style>
