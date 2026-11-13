/**
 * "Show spaces" (like Notepad++'s Show all characters): rendered titles split into plain text and
 * the characters to outline. Each space is its own segment, so a double space shows as two boxes.
 * Applied to text that is already cut to fit, so the "..." cut never changes.
 */
export interface TextSegment {
  text: string
  /** `space`: U+0020. `other`: another space character (a tab, NBSP, …). `invisible`: zero width. */
  kind: 'text' | 'space' | 'other' | 'invisible'
  /** For `other` and `invisible`: the character's code point and name, for a tooltip. */
  name?: string
}

const OTHER: Record<string, string> = {
  '\t': 'TAB',
  ' ': 'NO-BREAK SPACE',
  ' ': 'EN QUAD',
  ' ': 'EM QUAD',
  ' ': 'EN SPACE',
  ' ': 'EM SPACE',
  ' ': 'THREE-PER-EM SPACE',
  ' ': 'FOUR-PER-EM SPACE',
  ' ': 'SIX-PER-EM SPACE',
  ' ': 'FIGURE SPACE',
  ' ': 'PUNCTUATION SPACE',
  ' ': 'THIN SPACE',
  ' ': 'HAIR SPACE',
  ' ': 'NARROW NO-BREAK SPACE',
  ' ': 'MEDIUM MATHEMATICAL SPACE',
  '　': 'IDEOGRAPHIC SPACE',
}
const INVISIBLE: Record<string, string> = {
  '​': 'ZERO WIDTH SPACE',
  '‌': 'ZERO WIDTH NON-JOINER',
  '‍': 'ZERO WIDTH JOINER',
  '⁠': 'WORD JOINER',
  '﻿': 'ZERO WIDTH NO-BREAK SPACE (BOM)',
}

/** U+0020 and the other space characters (tab, NBSP, …), for marking them in the editor. */
export const SPACE_CHARS = new RegExp(`[ ${Object.keys(OTHER).join('')}]`, 'g')

const codePoint = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`

/** What kind of character `ch` is for Show spaces, with its name for the unusual ones. */
export function spaceKind(ch: string): Pick<TextSegment, 'kind' | 'name'> {
  if (ch === ' ') return { kind: 'space' }
  const other = OTHER[ch]
  if (other) return { kind: 'other', name: `${codePoint(ch)} ${other}` }
  const invisible = INVISIBLE[ch]
  if (invisible) return { kind: 'invisible', name: `${codePoint(ch)} ${invisible}` }
  return { kind: 'text' }
}

/** `text` as runs of plain text and one segment per space-like character. Joined back, it's `text`. */
export function splitSpaces(text: string): TextSegment[] {
  const out: TextSegment[] = []
  let run = ''
  for (const ch of text) {
    const k = spaceKind(ch)
    if (k.kind === 'text') {
      run += ch
      continue
    }
    if (run) out.push({ text: run, kind: 'text' })
    run = ''
    out.push({ text: ch, ...k })
  }
  if (run) out.push({ text: run, kind: 'text' })
  return out
}

/** The CSS class that outlines a segment, or '' for plain text. */
export const SPACE_CLASS: Record<TextSegment['kind'], string> = { text: '', space: 'ws', other: 'ws ws-other', invisible: 'ws ws-zero' }
