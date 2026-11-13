import { shallowRef } from 'vue'
import { browserStorage } from './saved'

/**
 * A song ticker font from the user's own skin: a bitmap font PNG (white glyphs on transparency, in
 * the order of lib/ticker.ts GLYPH_ROWS) and its Wasabi `<bitmapfont>` metrics. Kept in this
 * browser only: skin art is the skin author's, so the playground never ships or uploads one.
 */
export interface TickerFont {
  /** The PNG as a data: URL. */
  dataUrl: string
  /** The file name, for the settings panel. */
  name: string
  charWidth: number
  charHeight: number
  /** Added to charWidth between glyphs (Winamp Modern uses -1: the glyphs' glow overlaps). */
  hspacing: number
}

export type TickerMetrics = Pick<TickerFont, 'charWidth' | 'charHeight' | 'hspacing'>

export const TICKER_FONT_KEY = 'atf-playground:ticker-font'
/** Bigger files are refused: a song ticker font is a few kB. */
export const MAX_TICKER_FONT_BYTES = 512 * 1024

export const TICKER_PRESETS: { id: string; label: string; metrics: TickerMetrics; sheet: [number, number] }[] = [
  { id: 'player', label: 'Winamp Modern player (10×22, −1)', metrics: { charWidth: 10, charHeight: 22, hspacing: -1 }, sheet: [320, 66] },
  { id: 'shade', label: 'Winamp Modern shade (7×12, −1)', metrics: { charWidth: 7, charHeight: 12, hspacing: -1 }, sheet: [300, 40] },
]
export const DEFAULT_TICKER_METRICS: TickerMetrics = TICKER_PRESETS[0]!.metrics

/** The preset whose sheet is exactly this size, if any. */
export const presetForSheet = (width: number, height: number) => TICKER_PRESETS.find((p) => p.sheet[0] === width && p.sheet[1] === height)
/** The preset these metrics match, if any. */
export const presetForMetrics = (m: TickerMetrics) =>
  TICKER_PRESETS.find((p) => p.metrics.charWidth === m.charWidth && p.metrics.charHeight === m.charHeight && p.metrics.hspacing === m.hspacing)

const int = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined

/** Metrics kept in range: 1–64 px glyphs, hspacing -16 to 16 (but never a zero or negative advance). */
export function cleanMetrics(m: Partial<Record<keyof TickerMetrics, unknown>>): TickerMetrics | undefined {
  const charWidth = int(m.charWidth, 1, 64)
  const charHeight = int(m.charHeight, 1, 64)
  const hspacing = int(m.hspacing, -16, 16)
  if (charWidth === undefined || charHeight === undefined || hspacing === undefined || charWidth + hspacing < 1) return undefined
  return { charWidth, charHeight, hspacing }
}

/** A stored font, or null if there's none or it's malformed. */
export function parseTickerFont(raw: string | null | undefined): TickerFont | null {
  try {
    const v = JSON.parse(raw ?? 'null') as Record<string, unknown> | null
    if (!v || typeof v !== 'object' || typeof v.dataUrl !== 'string' || !v.dataUrl.startsWith('data:image/')) return null
    const m = cleanMetrics(v)
    return m ? { dataUrl: v.dataUrl, name: typeof v.name === 'string' ? v.name : 'songtickerfont.png', ...m } : null
  } catch {
    return null
  }
}

function read(): TickerFont | null {
  try {
    return parseTickerFont(browserStorage()?.getItem(TICKER_FONT_KEY))
  } catch {
    return null
  }
}

/** The skin font in use, or null for the bundled default. */
export const tickerFont = shallowRef<TickerFont | null>(read())

/**
 * Uses `font` (null: back to the default) and stores it. False if this browser wouldn't store it
 * (private window, storage full): it's still used until the page closes.
 */
export function setTickerFont(font: TickerFont | null): boolean {
  tickerFont.value = font
  try {
    const s = browserStorage()
    if (!s) return false
    if (font) s.setItem(TICKER_FONT_KEY, JSON.stringify(font))
    else s.removeItem(TICKER_FONT_KEY)
    return true
  } catch {
    return false
  }
}
