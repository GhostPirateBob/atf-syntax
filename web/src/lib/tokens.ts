import { FUNCTION_MAP } from '@/core'

export type TokenKind =
  | 'text'
  | 'field'
  | 'fn'
  | 'fn-unknown'
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
      push('field', p, q + 1)
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
      push(FUNCTION_MAP.has(name) ? 'fn' : 'fn-unknown', p, q)
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
    } else {
      push('text', p, p + 1)
      p++
    }
  }
  return out
}
