/**
 * "Show spaces" (like Notepad++'s Show all characters), in the format editor: which characters get
 * an outline. Each space is outlined on its own, so a double space shows as two boxes.
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
