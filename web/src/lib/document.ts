/**
 * The editor holds a format the way an `.atf` file does: lines are joined with no separator (so a
 * long format can wrap), and a line starting with `#` is a comment. `toFormat` builds the single
 * string WACUP sees, plus a map from each format offset back to its position in the document.
 */
export interface FormatView {
  /** The format string WACUP would get. */
  format: string
  /** `map[i]` is the document offset of `format[i]`; `map[format.length]` is the end position. */
  map: number[]
}

export function toFormat(doc: string): FormatView {
  let format = ''
  const map: number[] = []
  let lineStart = 0
  for (const line of doc.split('\n')) {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!text.startsWith('#')) {
      for (let i = 0; i < text.length; i++) map.push(lineStart + i)
      format += text
    }
    lineStart += line.length + 1
  }
  const last = map[map.length - 1]
  map.push(last === undefined ? 0 : last + 1)
  return { format, map }
}

/** Document position for a format offset (clamped). */
export function docPos(view: FormatView, offset: number): number {
  const i = Math.max(0, Math.min(offset, view.map.length - 1))
  return view.map[i] ?? 0
}

/** Document range for a format range; `end` maps to just after the last character. */
export function docRange(view: FormatView, start: number, end: number): { from: number; to: number } {
  const from = docPos(view, start)
  const to = end > start ? docPos(view, end - 1) + 1 : from
  return { from, to }
}
