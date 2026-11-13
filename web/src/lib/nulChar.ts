// NUL (U+0000) in the format text. WACUP's format string is a C string, so it stops reading at the
// first NUL. The playground flags it (and offers to remove it) but never strips it silently: what the
// evaluator receives stays what WACUP would receive.
import type { Finding } from '@/core'

export const NUL_RULE = 'nul-character'
export const NUL_MESSAGE = 'This format contains a NUL character. WACUP stops reading the format here, so nothing after it is used.'

/** The offsets of every NUL in `text`, in order. */
export function nulOffsets(text: string): number[] {
  const out: number[] = []
  for (let i = text.indexOf('\0'); i >= 0; i = text.indexOf('\0', i + 1)) out.push(i)
  return out
}

/**
 * A warning at the first NUL of the joined format (later ones don't matter: WACUP never gets that
 * far). Its rule isn't one of the extension's, hence the cast; nothing switches on it.
 */
export function nulFindings(format: string): Finding[] {
  const first = format.indexOf('\0')
  if (first < 0) return []
  return [{ start: first, end: first + 1, severity: 'warning', message: NUL_MESSAGE, rule: NUL_RULE as Finding['rule'] }]
}
