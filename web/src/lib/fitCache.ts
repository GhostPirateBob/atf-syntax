import { fitText } from './fit'

/** Entries kept before a cache starts over (a few playlists' worth of rows at a few widths). */
export const FIT_CACHE_MAX = 20_000
/** Fitted titles by everything that decides the cut. */
export const fitCache = new Map<string, string>()
/** Text widths by font and text: the duration and number columns repeat on every row. */
const widthCache = new Map<string, number>()

/** Empties both caches: a web font arrived, so widths changed. */
export function clearFitCache(): void {
  fitCache.clear()
  widthCache.clear()
}

function remember<V>(cache: Map<string, V>, key: string, value: V): V {
  if (cache.size >= FIT_CACHE_MAX) cache.clear()
  cache.set(key, value)
  return value
}

export interface FitOptions {
  duration: string
  prefix: string
  width: number
  font: string
  gap: number
}

/**
 * A playlist row's title, cut WACUP-style ("Long Tit... 4:20") to fit the row beside its duration.
 * `prefix` (the playlist number) is drawn in front and never cut. `font` is a canvas/CSS font
 * shorthand matching the row; `gap` is the space kept before the duration, in px. `measure` gives
 * a string's width in that font.
 *
 * Cached per (title, font, width, duration, prefix, gap), so re-renders, a step through the
 * playlist and scrolling back to a row cost a lookup, not a dozen canvas measurements; the
 * duration and prefix widths are cached per (text, font).
 */
export function fitRow(title: string, opts: FitOptions, measure: (text: string, font: string) => number): string {
  if (opts.width <= 0 || !title) return title
  const key = `${opts.font}\u0000${opts.width}\u0000${opts.gap}\u0000${opts.prefix}\u0000${opts.duration}\u0000${title}`
  const known = fitCache.get(key)
  if (known !== undefined) return known
  const width = (text: string) => {
    const k = `${opts.font}\u0000${text}`
    return widthCache.get(k) ?? remember(widthCache, k, measure(text, opts.font))
  }
  const used = (opts.duration ? width(opts.duration) + opts.gap : 0) + (opts.prefix ? width(opts.prefix) : 0)
  // 1 px spare: canvas and DOM text can differ by a fraction of a pixel.
  return remember(fitCache, key, fitText(title, opts.width - used - 1, (s) => measure(s, opts.font)))
}
