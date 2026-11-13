<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { History } from '@lucide/vue'
import throttle from 'lodash-es/throttle'
import { frames } from '@/lib/timing'
import { browserStorage } from '@/lib/saved'
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
import { ensureIndex, loading, searcher } from '@/lib/searchSession'

/**
 * The search's results: a grouped listbox for the header box's combobox (OmniSearch.vue), with its
 * keys, recent searches and where each result goes. A lazy chunk of its own, loaded when the page
 * is idle or the box is used; the box (and what's typed into it) works before it arrives. The box
 * owns focus and the input; it passes keys here (onKey) and shows `state` in its ARIA attributes.
 */
const props = defineProps<{ query: string; page: SearchPage; refListed: (target: string) => boolean; hint: string }>()
const emit = defineEmits<{
  action: [action: PlaygroundAction]
  /** A result was picked: the box clears and closes. */
  picked: []
  /** A recent search was picked: the box takes its text. */
  setQuery: [text: string]
  /** The active option's id, and whether any options show, for the combobox's attributes. */
  state: [state: { activeId: string | undefined; expanded: boolean }]
}>()

const active = ref(-1)

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

onMounted(() => void ensureIndex().catch(() => {}))

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
const q = computed(() => props.query.trim())
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
          ? { id: `omni-recent-${i}`, title: highlight(r.text, []), sig: '', body: '', mono: false, icon: 'history' as const, pick: () => emit('setQuery', r.text) }
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
watch([activeId, () => flat.value.length > 0], ([id, expanded]) => emit('state', { activeId: id, expanded }), { immediate: true })
const countText = computed(() => {
  if (!q.value || loading.value) return ''
  const n = flat.value.length
  return n ? `${n} result${n === 1 ? '' : 's'}. Use Up and Down to choose, Enter to open.` : 'No results.'
})

/** The results' scrolling box. */
const pop = ref<HTMLElement>()
/** Set by Up and Down: only a move by key needs the active option scrolled into view. */
let keyMove = false
// New results start at the top: a scroll write, no layout read (scrollIntoView on every keystroke
// forced a layout each time).
watch(
  q,
  () => {
    active.value = q.value ? 0 : -1
    if (pop.value) pop.value.scrollTop = 0
  },
  { immediate: true },
)
watch(activeId, async (id) => {
  if (!keyMove) return
  keyMove = false
  await nextTick()
  if (id) document.getElementById(id)?.scrollIntoView({ block: 'nearest' })
})

/** Up, Down and Enter from the box. True if the key was used. */
function onKey(e: KeyboardEvent): boolean {
  const n = flat.value.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') keyMove = true
  if (e.key === 'ArrowDown') {
    if (n) active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp') {
    if (n) active.value = active.value <= 0 ? n - 1 : active.value - 1
  } else if (e.key === 'Enter') {
    const o = flat.value[active.value]
    if (!o) return false
    o.pick()
  } else return false
  return true
}
/** The pointer over an option makes it the active one: at most once a frame, the last move always applied. */
const onOptionMove = throttle((o: (typeof flat.value)[number]) => (active.value = flat.value.indexOf(o)), frames(1), { leading: true, trailing: true })
onBeforeUnmount(() => onOptionMove.cancel())

// ---- going to a result ------------------------------------------------------------------------
function go(doc: SearchDoc) {
  if (q.value) remember({ type: 'query', text: q.value })
  remember({ type: 'pick', id: doc.id, title: doc.title, kind: doc.kind })
  emit('picked')
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

defineExpose({ onKey })
</script>

<template>
  <div ref="pop" class="omni-pop" @mousedown.prevent>
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
    <span class="omni-live" role="status" aria-live="polite">{{ countText }}</span>
  </div>
</template>

<style scoped>
/* Where the popup sits (and its phone layout) is in OmniSearch.vue; this is what's inside it. */
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
</style>
