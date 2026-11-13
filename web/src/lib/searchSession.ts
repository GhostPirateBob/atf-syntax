import { ref, shallowRef, triggerRef, watch } from 'vue'
import { savedFormats } from './saved'
import type { Searcher } from './searchCorpus'

// The search's index for the page, shared by the header's box (which warms it when the page is
// idle) and the palette (which searches it). Loaded with the palette, never at startup.

export const searcher = shallowRef<Searcher>()
/** True while a search waits for the index (not during a quiet warm-up). */
export const loading = ref(false)

let pending: Promise<void> | undefined
/** Loads the corpus chunk and restores its prebuilt index. `quiet`: a warm-up, so no "Loading" message. */
export function ensureIndex(quiet = false): Promise<void> {
  if (searcher.value) return Promise.resolve()
  if (!quiet) loading.value = true
  pending ??= (async () => {
    try {
      const { makeSearcher } = await import('./searchCorpus')
      searcher.value = await makeSearcher(savedFormats.value)
    } finally {
      loading.value = false
      pending = undefined
    }
  })()
  return pending
}

// Saved formats change while the page is open: keep the index in step.
watch(
  savedFormats,
  () => {
    if (!searcher.value) return
    searcher.value.setSaved(savedFormats.value)
    triggerRef(searcher)
  },
  { deep: true },
)
