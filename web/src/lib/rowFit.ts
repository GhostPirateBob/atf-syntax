import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { clearFitCache, fitRow as fitRowWith, type FitOptions } from './fitCache'
import { measureText } from './measure'
import throttle from 'lodash-es/throttle'
import { frames } from './timing'

/**
 * Bumped each time a web font finishes loading. Web fonts swap in after the first render, so
 * widths measured before then are redone.
 */
export const fontsLoaded = ref(0)
if (typeof document !== 'undefined')
  document.fonts?.addEventListener('loadingdone', () => {
    clearFitCache()
    fontsLoaded.value++
  })

/**
 * The content-box width of an element, kept up to date. 0 until it's in the page. Resizes are
 * taken at most every two frames (the first at once, the last always), using the latest size.
 */
export function useWidth(el: Ref<Element | null | undefined>): Ref<number> {
  const width = ref(0)
  let latest = 0
  const apply = throttle(() => (width.value = latest), frames(2), { leading: true, trailing: true })
  const observer = new ResizeObserver((entries) => {
    const e = entries[entries.length - 1]
    if (!e) return
    latest = e.contentRect.width
    apply()
  })
  watch(
    el,
    (now, old) => {
      if (old) observer.unobserve(old)
      if (now) observer.observe(now)
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(() => {
    observer.disconnect()
    apply.cancel()
  })
  return width
}

/** A playlist row's title cut to fit beside its duration, measured with canvas (see lib/fitCache.ts). */
export const fitRow = (title: string, opts: FitOptions): string => fitRowWith(title, opts, measureText)
