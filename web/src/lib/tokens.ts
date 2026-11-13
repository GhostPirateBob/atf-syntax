import { FUNCTION_MAP } from '@/core'

export type TokenKind =
  | 'text'
  /** A field's name (between its `%` signs). */
  | 'field'
  /** Each `%` of a field. */
  | 'field-sigil'
  /** A known function's name (after its `$`). */
  | 'fn'
  /** The `$` of a known function. */
  | 'fn-sigil'
  /** An unknown function, `$` and name together (one squiggle). */
  | 'fn-unknown'
  /** An integer argument inside a call (a run of digits, maybe after a minus, standing alone). */
  | 'number'
  | 'paren'
  | 'bracket'
  | 'quote'
  | 'escape'
  | 'comma'
  | 'broken'

export interface Token {
  kind: TokenKind
  start: number
  end: number
}

/**
 * Split a format into highlight tokens, following WACUP's lexical rules (spec §1): `%name%` fields,
 * `$name(` calls, `'quoted'` literals, `%%` `$$` `''` escapes, `[ ]` sections, and commas only inside
 * a call. Unterminated constructs become `broken`; the linter explains them, so this never throws.
 * The sigils (`$`, both `%`) are tokens of their own, so they can be coloured apart from the names.
 */
export function tokenize(s: string): Token[] {
  const out: Token[] = []
  let depth = 0
  let p = 0
  const push = (kind: TokenKind, start: number, end: number) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind && last.end === start && (kind === 'text' || kind === 'broken')) last.end = end
    else out.push({ kind, start, end })
  }
  while (p < s.length) {
    const c = s[p]
    if (c === '%') {
      if (s[p + 1] === '%') {
        push('escape', p, p + 2)
        p += 2
        continue
      }
      const q = s.indexOf('%', p + 1)
      if (q < 0) {
        push('broken', p, s.length)
        break
      }
      push('field-sigil', p, p + 1)
      push('field', p + 1, q)
      push('field-sigil', q, q + 1)
      p = q + 1
    } else if (c === '$') {
      if (s[p + 1] === '$') {
        push('escape', p, p + 2)
        p += 2
        continue
      }
      const q = s.indexOf('(', p + 1)
      if (q < 0) {
        push('broken', p, s.length)
        break
      }
      const name = s.slice(p + 1, q).toLowerCase()
      if (FUNCTION_MAP.has(name)) {
        push('fn-sigil', p, p + 1)
        push('fn', p + 1, q)
      } else push('fn-unknown', p, q)
      push('paren', q, q + 1)
      depth++
      p = q + 1
    } else if (c === "'") {
      if (s[p + 1] === "'") {
        push('escape', p, p + 2)
        p += 2
        continue
      }
      const q = s.indexOf("'", p + 1)
      if (q < 0) {
        push('broken', p, s.length)
        break
      }
      push('quote', p, q + 1)
      p = q + 1
    } else if (c === '[' || c === ']') {
      push('bracket', p, p + 1)
      p++
    } else if (c === '(' || c === ')') {
      if (c === ')' && depth > 0) depth--
      push(depth > 0 || c === ')' ? 'paren' : 'broken', p, p + 1)
      p++
    } else if (c === ',' && depth > 0) {
      push('comma', p, p + 1)
      p++
    } else if (depth > 0 && isNumberStart(s, p)) {
      let q = p + 1
      while (q < s.length && isDigit(s[q]!)) q++
      push(isWordChar(s[q]) ? 'text' : 'number', p, q)
      p = q
    } else {
      push('text', p, p + 1)
      p++
    }
  }
  return out
}

const isDigit = (c: string) => c >= '0' && c <= '9'
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c)
/** A digit (or a minus before one) that doesn't continue a word: the start of an integer argument. */
function isNumberStart(s: string, p: number): boolean {
  const c = s[p]!
  const digit = isDigit(c) || (c === '-' && isDigit(s[p + 1] ?? ''))
  return digit && !isWordChar(s[p - 1])
}
