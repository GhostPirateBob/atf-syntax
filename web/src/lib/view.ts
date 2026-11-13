import type { DisplayOptions } from './display'

/** How titles are shown and checked. Saved in localStorage; none of it is part of the format. */
export interface ViewSettings extends DisplayOptions {
  /** A font name typed by the user; takes priority over `fontFamily`. */
  font: string
  /** The font picked from the list: one font name, '' = the default Roboto Condensed. */
  fontFamily: string
  fontSize: number
  /** Playlist width in px; 0 = the full available width. */
  width: number
  /** WACUP's "1. " playlist numbers in front of each row. */
  numbers: boolean
  /** The track length on the right of each row. The song ticker has no such column. */
  duration: boolean
  /** Show spaces: each space in the format editor gets a dashed box, like Notepad++'s Show all characters. */
  spaces: boolean
  /** Linter dialect. The preview is always WACUP 1.99.57. */
  dialect: 'wacup' | 'winamp'
}

export const DEFAULT_VIEW: ViewSettings = {
  trimLeading: true,
  underscoresToSpaces: true,
  pct20ToSpaces: true,
  font: '',
  fontFamily: '',
  fontSize: 16,
  width: 0,
  numbers: false,
  duration: true,
  spaces: true,
  dialect: 'wacup',
}

/**
 * Saved settings over the defaults. Settings saved by older versions lack newer keys, and a key
 * with the wrong type (hand-edited, or from a version that stored it differently) is dropped.
 */
export function parseView(saved: string | null): ViewSettings {
  let raw: unknown
  try {
    raw = JSON.parse(saved ?? '{}')
  } catch {
    raw = {}
  }
  const out: ViewSettings = { ...DEFAULT_VIEW }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_VIEW) as (keyof ViewSettings)[]) {
    if (typeof r[key] === typeof DEFAULT_VIEW[key]) (out as unknown as Record<string, unknown>)[key] = r[key]
  }
  if (out.dialect !== 'wacup' && out.dialect !== 'winamp') out.dialect = DEFAULT_VIEW.dialect
  return out
}

/** The font size actually used: 8 to 40 px. */
export const clampFontSize = (px: number) => Math.min(40, Math.max(8, px || DEFAULT_VIEW.fontSize))
