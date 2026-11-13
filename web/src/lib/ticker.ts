/**
 * The song ticker preview: one line, scrolled left one character at a time, the text followed by a
 * separator and repeating, like Winamp's main-window ticker. Pure functions; SongTicker.vue runs
 * the timer and draws.
 */

import { frames } from './timing'

/** What follows the title before it starts again: Winamp 2's (and Webamp's) `  ***  `. */
export const TICKER_SEPARATOR = '  ***  '
/** One glyph every 20 frames (333 ms), in the owner's 250 to 500 ms range for a readable ticker. */
export const TICKER_STEP_MS = frames(20)
/** Longer titles are cut here, so the strip stays a sane size (a canvas has a width limit). */
export const TICKER_MAX_CHARS = 1024

/** A character of the strip and how far it moves the next one along, in px. */
export interface TickerItem {
  ch: string
  advance: number
}

/** The characters of a title, by code point (so an emoji or accented letter is one step). */
export const tickerChars = (text: string): string[] => Array.from(text).slice(0, TICKER_MAX_CHARS)

export const totalAdvance = (items: readonly TickerItem[]): number => items.reduce((sum, it) => sum + it.advance, 0)

/**
 * The strip for a loop `unit` (the title then the separator): the unit repeated until it covers
 * `visible` px from any step inside the first unit, so the line never runs out as it scrolls.
 */
export function tickerStrip<T extends TickerItem>(unit: readonly T[], visible: number): T[] {
  const width = totalAdvance(unit)
  if (!unit.length || width <= 0) return [...unit]
  const repeats = 1 + Math.max(1, Math.ceil(visible / width))
  return Array.from({ length: repeats }, () => unit).flat()
}

/** The step after `step`: one character on, and back to 0 after a whole unit (seamless, since the strip repeats). */
export const nextStep = (step: number, unitLength: number): number => (unitLength > 0 ? (step + 1) % unitLength : 0)

/** How far left the strip sits at `step`, in px: the advances of the characters scrolled off. */
export function stripOffset(unit: readonly TickerItem[], step: number): number {
  let x = 0
  for (let i = 0; i < step && i < unit.length; i++) x += unit[i]!.advance
  return x
}

// ---- bitmap fonts --------------------------------------------------------------------------------

/**
 * The glyph order of a Winamp bitmap font sheet: classic `text.bmp`'s, which Winamp 5 Modern's
 * song ticker fonts (Wasabi `<bitmapfont>`) follow too. Checked against WinampModern's
 * player/Songtickerfont.png (32 × 3 cells of 10 × 22) and shade/songtickerfont.PNG (7 × 12): the
 * cells after the last glyph in each row are blank.
 */
export const GLYPH_ROWS = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ"@', '0123456789….:()-\'!_+\\/[]^&%,=$#', 'ÅÖÄ?*'] as const

const CELLS = new Map<string, { row: number; col: number }>()
GLYPH_ROWS.forEach((chars, row) => Array.from(chars).forEach((ch, col) => CELLS.set(ch, { row, col })))

/** Characters drawn with a near look-alike, as Webamp does for the brackets. */
const ALIASES: Record<string, string> = {
  '<': '[', '>': ']', '{': '[', '}': ']',
  '‘': "'", '’': "'", '`': "'", '´': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '−': '-',
}

/**
 * The sheet cell (row, column) that draws `ch`, or null for a blank (a space). The sheets have
 * capitals only, so a lower-case letter uses its capital; a few look-alikes stand in for missing
 * punctuation; an accented letter without its own glyph drops the accent (é → E). Anything else
 * is a space.
 */
export function glyphCell(ch: string): { row: number; col: number } | null {
  const direct = CELLS.get(ch) ?? CELLS.get(ALIASES[ch] ?? '')
  if (direct) return direct
  const upper = ch.toUpperCase()
  const cased = upper.length === 1 ? CELLS.get(upper) : undefined
  if (cased) return cased
  const bare = upper.normalize('NFD').replace(/\p{M}+/gu, '')
  return bare.length === 1 ? (CELLS.get(bare) ?? null) : null
}
