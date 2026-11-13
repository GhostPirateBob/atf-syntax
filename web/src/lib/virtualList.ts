/**
 * The maths of a virtualised list: only the rows in (or near) the scrolled view get DOM, with
 * spacers above and below standing in for the rest. Rows can differ in height (an open tag
 * editor, a wrapped meta line); unmeasured rows count as the usual row height.
 */

/** Each row's top, plus the total height at the end: `offsets[i]` is row i's top, `offsets[count]` the list's height. */
export function rowOffsets(count: number, heightOf: (index: number) => number): Float64Array {
  const offsets = new Float64Array(count + 1)
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i]! + heightOf(i)
  return offsets
}

/** The first row whose bottom is below `y` (count if none). */
function rowAt(offsets: Float64Array, y: number): number {
  const count = offsets.length - 1
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1]! > y) hi = mid
    else lo = mid + 1
  }
  return lo
}

export interface ListWindow {
  /** First row rendered. */
  start: number
  /** One past the last row rendered. */
  end: number
  /** Height of the spacer above the rendered rows, in px. */
  padTop: number
  /** Height of the spacer below them, in px. */
  padBottom: number
}

/**
 * The rows to render for a list scrolled to `scrollTop` with a `viewport` px tall view: those that
 * overlap it, plus `overscan` rows each side. Before the view's height is known (0), `fallbackRows`
 * rows from the scroll position are rendered, so there is something to measure.
 */
export function visibleWindow(offsets: Float64Array, scrollTop: number, viewport: number, overscan: number, fallbackRows = 5): ListWindow {
  const count = offsets.length - 1
  const total = offsets[count]!
  if (count === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }
  // The browser never scrolls past the end; a stale position (the list just got shorter) is clamped too.
  const top = Math.max(0, Math.min(scrollTop, total - viewport))
  const first = Math.min(rowAt(offsets, top), count - 1)
  const last = viewport > 0 ? Math.min(rowAt(offsets, top + viewport - 0.5), count - 1) : Math.min(first + fallbackRows - 1, count - 1)
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, last + 1 + overscan)
  return { start, end, padTop: offsets[start]!, padBottom: total - offsets[end]! }
}

/** Rows fully or partly inside the view (no overscan): the ones worth evaluating first. */
export function rowsInView(offsets: Float64Array, scrollTop: number, viewport: number, fallbackRows = 5): number[] {
  const w = visibleWindow(offsets, scrollTop, viewport, 0, fallbackRows)
  return Array.from({ length: w.end - w.start }, (_, k) => w.start + k)
}

/**
 * The scroll position that shows row `index` whole: unchanged if it already shows, otherwise the
 * least scrolling that brings it in (its top at the top when it's above, its bottom at the bottom
 * when it's below).
 */
export function scrollToShow(offsets: Float64Array, index: number, scrollTop: number, viewport: number): number {
  const count = offsets.length - 1
  if (index < 0 || index >= count) return scrollTop
  const top = offsets[index]!
  const bottom = offsets[index + 1]!
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewport) return Math.max(0, bottom - viewport)
  return scrollTop
}
