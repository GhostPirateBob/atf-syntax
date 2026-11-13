import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { fitText } from './fit'
import { measureText } from './measure'

/**
 * Bumped each time a web font finishes loading. Web fonts arrive after the country check (or
 * never, in the GDPR area), so widths measured before then are redone.
 */
export const fontsLoaded = ref(0)
if (typeof document !== 'undefined') document.fonts?.addEventListener('loadingdone', () => fontsLoaded.value++)

/** The content-box width of an element, kept up to date. 0 until it's in the page. */
export function useWidth(el: Ref<Element | null | undefined>): Ref<number> {
  const width = ref(0)
  const observer = new ResizeObserver((entries) => {
    const e = entries[entries.length - 1]
    if (e) width.value = e.contentRect.width
  })
  watch(
    el,
    (now, old) => {
      if (old) observer.unobserve(old)
      if (now) observer.observe(now)
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(() => observer.disconnect())
  return width
}

/**
 * A playlist row's title, cut WACUP-style ("Long Tit... 4:20") to fit the row beside its duration.
 * `prefix` (the playlist number) is drawn in front and never cut. `font` is a canvas/CSS font
 * shorthand matching the row; `gap` is the space kept before the duration, in px.
 */
export function fitRow(title: string, opts: { duration: string; prefix: string; width: number; font: string; gap: number }): string {
  if (opts.width <= 0 || !title) return title
  const used = (opts.duration ? measureText(opts.duration, opts.font) + opts.gap : 0) + (opts.prefix ? measureText(opts.prefix, opts.font) : 0)
  // 1 px spare: canvas and DOM text can differ by a fraction of a pixel.
  return fitText(title, opts.width - used - 1, (s) => measureText(s, opts.font))
}
