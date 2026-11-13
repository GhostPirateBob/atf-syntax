import type { Finding } from '@/core'
import { docRange, toFormat, type FormatView } from './document'
import { tokenize } from './tokens'

// The format's highlighting as document ranges, shared by the editor (lib/atfEditor.ts) and the
// static copy shown until the editor has loaded (components/AtfEditor.vue), so both colour a
// format the same way.

/** The empty editor's hint, and the editor's accessible name (the static copy shows the same). */
export const EDITOR_PLACEHOLDER = 'Type a title format, e.g. [%artist% - ]%title%'
export const EDITOR_LABEL = 'ATF title format'

export interface Mark {
  from: number
  to: number
  cls: string
}

/** Split a format range into document ranges that skip comment lines. */
function docSegments(view: FormatView, start: number, end: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let i = start
  while (i < end) {
    let j = i + 1
    while (j < end && view.map[j] === (view.map[j - 1] ?? 0) + 1) j++
    const from = view.map[i] ?? 0
    out.push({ from, to: (view.map[j - 1] ?? from) + 1 })
    i = j
  }
  return out
}

/** Token marks (`tok-<kind>`) and comment lines (`tok-comment`), sorted by position, none empty. */
export function highlightMarks(doc: string): Mark[] {
  const view = toFormat(doc)
  const marks: Mark[] = []
  for (const token of tokenize(view.format)) {
    if (token.kind === 'text') continue
    for (const seg of docSegments(view, token.start, token.end)) marks.push({ ...seg, cls: `tok-${token.kind}` })
  }
  let pos = 0
  for (const line of doc.split('\n')) {
    if (line.startsWith('#')) marks.push({ from: pos, to: pos + line.length, cls: 'tok-comment' })
    pos += line.length + 1
  }
  return marks.filter((m) => m.to > m.from).sort((a, b) => a.from - b.from || a.to - b.to)
}

/**
 * Where each finding's squiggle goes in the document: at least one character, inside the
 * document. `fv` is the document's format view (toFormat).
 */
export function findingRange(fv: FormatView, docLength: number, f: Finding): { from: number; to: number } {
  const r = docRange(fv, f.start, Math.max(f.end, f.start + 1))
  const from = Math.min(r.from, docLength)
  return { from, to: Math.min(Math.max(r.to, from + 1), docLength) }
}

/**
 * Control and invisible characters the editor marks in red (CodeMirror's highlightSpecialChars
 * defaults): controls below U+0020 as their Control Pictures glyph (U+2400 + code, ␀ for NUL),
 * the rest as `•`.
 */
const SPECIAL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202d\u202e\u2066\u2067\u2069\ufeff\ufff9-\ufffc]/

export interface Piece {
  text: string
  cls: string
}
/** Pieces under the same squiggles, wrapped in one span as the editor does (so a wavy line runs on unbroken). */
export interface PieceGroup {
  cls: string
  pieces: Piece[]
}
export interface StaticLine {
  /** Document offset of the line's first character. */
  from: number
  groups: PieceGroup[]
}

/**
 * The document as the editor shows it, line by line, for the static copy: runs of text with the
 * editor's classes (token colours, squiggles, show-spaces marks), special characters as above.
 * Lines split where the editor's do (\r\n, \r or \n).
 */
export function staticLines(doc: string, opts: { spaces?: boolean; squiggles?: { from: number; to: number; severity: string }[] } = {}): StaticLine[] {
  const squiggles: Mark[] = (opts.squiggles ?? []).map((s) => ({ from: s.from, to: s.to, cls: `squiggle squiggle-${s.severity}` }))
  const marks: Mark[] = [...highlightMarks(doc), ...squiggles]
  const lines: StaticLine[] = []
  const breaks = /\r\n?|\n/g
  let from = 0
  for (;;) {
    const m = breaks.exec(doc)
    const to = m ? m.index : doc.length
    const text = doc.slice(from, to)
    const here = marks.filter((k) => k.to > from && k.from < to)
    const cuts = new Set([0, text.length])
    for (const k of here) cuts.add(Math.max(0, k.from - from)).add(Math.min(text.length, k.to - from))
    const trailing = opts.spaces ? text.length - (/\s*$/.exec(text)?.[0].length ?? 0) : text.length
    cuts.add(trailing)
    for (let i = 0; i < text.length; i++) if (SPECIAL.test(text[i]!) || (opts.spaces && (text[i] === ' ' || text[i] === '\t'))) cuts.add(i).add(i + 1)
    const points = [...cuts].sort((a, b) => a - b)
    const groups: PieceGroup[] = []
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      if (b <= a) continue
      let t = text.slice(a, b)
      const covering = here.filter((k) => k.from <= from + a && k.to >= from + b)
      const outer = covering.filter((k) => squiggles.includes(k)).map((k) => k.cls).join(' ')
      const cls = covering.filter((k) => !squiggles.includes(k)).map((k) => k.cls)
      if (a >= trailing) cls.push('trailing-space')
      if (opts.spaces && t === ' ') cls.push('space')
      else if (opts.spaces && t === '\t') cls.push('tab')
      else if (t.length === 1 && SPECIAL.test(t)) {
        cls.push('special')
        const code = t.charCodeAt(0)
        t = code < 0x20 ? String.fromCharCode(0x2400 + code) : '•'
      }
      const last = groups[groups.length - 1]
      if (last && last.cls === outer) last.pieces.push({ text: t, cls: cls.join(' ') })
      else groups.push({ cls: outer, pieces: [{ text: t, cls: cls.join(' ') }] })
    }
    lines.push({ from, groups })
    if (!m) break
    from = m.index + m[0].length
  }
  return lines
}
