/**
 * Cut `text` to fit `maxWidth` the way WACUP's playlist does: keep the longest start that fits with
 * three ASCII dots after it. `measure` gives a string's width (measureText with the row's font).
 */
export function fitText(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text
  // Code points, so a cut never splits a surrogate pair.
  const chars = Array.from(text)
  let lo = 0
  let hi = chars.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(chars.slice(0, mid).join('') + '...') <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return chars.slice(0, lo).join('') + '...'
}
