/**
 * WACUP's own habits when it shows a title, applied after the format is evaluated. None of this is
 * ATF: it's how the player displays the result (Preferences → Titles, plus a trim we've observed).
 */
export interface DisplayOptions {
  /** WACUP drops leading whitespace, even em spaces, which is why people start formats with a `.`. */
  trimLeading: boolean
  /** "Show underscores in titles as spaces". */
  underscoresToSpaces: boolean
  /** "Show '%20's in titles as spaces". */
  pct20ToSpaces: boolean
}

export const DEFAULT_DISPLAY: DisplayOptions = {
  trimLeading: true,
  underscoresToSpaces: true,
  pct20ToSpaces: true,
}

export function applyDisplay(text: string, opts: DisplayOptions): string {
  let s = text
  if (opts.pct20ToSpaces) s = s.replaceAll('%20', ' ')
  if (opts.underscoresToSpaces) s = s.replaceAll('_', ' ')
  if (opts.trimLeading) s = s.replace(/^\s+/u, '')
  return s
}

/** Titles are shown on one line: each CR or LF shows as a space, as WACUP draws them on a playlist row (so $crlf() is two spaces). */
export const oneLine = (s: string) => s.replace(/[\r\n]/g, ' ')
