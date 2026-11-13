<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Search, X } from '@lucide/vue'
import { whenIdle } from '@/lib/timing'
import { vTip } from '@/lib/tooltip'
import type { PlaygroundAction } from '@/lib/searchAction'
import type { SearchPage } from '@/lib/search'

/**
 * The header's search over recipes, saved formats, functions, fields, lint rules, settings and
 * the wiki: an ARIA combobox (this box, part of the first render) with a grouped listbox (the
 * palette, OmniPalette.vue, a lazy chunk with the search code). The palette and the prebuilt index
 * load when the page is idle, or when the box is pointed at, focused, or opened with Ctrl+K or /.
 * Typing before they arrive goes into the box as usual, and the palette opens on that text. On
 * narrow screens the box is a search icon that opens a full-width overlay.
 */
const props = withDefaults(defineProps<{ page: SearchPage; refListed?: (target: string) => boolean }>(), { refListed: () => true })
const emit = defineEmits<{ action: [action: PlaygroundAction] }>()

const loadPalette = () => import('./OmniPalette.vue')
const OmniPalette = defineAsyncComponent(loadPalette)

const open = ref(false)
const query = ref('')
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const iconButton = ref<HTMLButtonElement>()
const palette = ref<{ onKey(e: KeyboardEvent): boolean }>()
/** From the palette: the active option and whether any show (the combobox's ARIA state). */
const activeId = ref<string>()
const expanded = ref(false)
/** Narrow screens, where the field is a search icon (keep in step with the @media rule in the styles). */
const ICON_ONLY = '(max-width: 760px)'
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const hint = isMac ? '⌘ K' : 'Ctrl K'

// ---- loading the palette and the index ----------------------------------------------------------
/** Fetches the palette and restores the index ahead of the first search, without a "Loading" message. */
function warm() {
  loadPalette().catch(() => {})
  import('@/lib/searchSession').then((s) => s.ensureIndex(true)).catch(() => {})
}
// Ready before the first open: once the page has settled (after the editor).
let cancelWarm: (() => void) | undefined
onMounted(() => (cancelWarm = whenIdle(warm, 4000)))
onBeforeUnmount(() => cancelWarm?.())

// ---- open, close, keys ------------------------------------------------------------------------
async function openSearch() {
  open.value = true
  warm()
  await nextTick()
  input.value?.focus()
}
function close(refocus = false) {
  if (!open.value) return
  open.value = false
  activeId.value = undefined
  expanded.value = false
  // The overlay hid the field: give focus back to the icon that opened it.
  // The icon only shows on narrow screens (the same query as the CSS below): no style read needed.
  if (refocus && iconButton.value && window.matchMedia(ICON_ONLY).matches) iconButton.value.focus()
}
function setQuery(text: string) {
  query.value = text
  input.value?.focus()
}
/** A result was picked: clear, close and let go of the box. */
function picked() {
  query.value = ''
  close()
  input.value?.blur()
}
function onState(s: { activeId: string | undefined; expanded: boolean }) {
  activeId.value = s.activeId
  expanded.value = s.expanded
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (!open.value) return
    close(true)
  } else if (e.key === 'ArrowDown' && !open.value) {
    void openSearch()
  } else if (!(open.value && palette.value?.onKey(e))) return
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
        :aria-expanded="open && expanded"
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
      <OmniPalette
        v-if="open"
        ref="palette"
        :query="query"
        :page="props.page"
        :ref-listed="props.refListed"
        :hint="hint"
        @action="emit('action', $event)"
        @picked="picked"
        @set-query="setQuery"
        @state="onState"
      />
    </div>
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
/* The palette's popup (OmniPalette.vue's root): placed under the box, or full screen on phones. */
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
