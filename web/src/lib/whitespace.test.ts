import { describe, expect, it } from 'vitest'
import { SPACE_CLASS, spaceKind, splitSpaces } from './whitespace'
import { DEFAULT_VIEW, parseView } from './view'

describe('Show spaces', () => {
  it('gives each space its own segment, so a double space is two boxes', () => {
    expect(splitSpaces('Juicy  The B.I.G.')).toEqual([
      { text: 'Juicy', kind: 'text' },
      { text: ' ', kind: 'space' },
      { text: ' ', kind: 'space' },
      { text: 'The', kind: 'text' },
      { text: ' ', kind: 'space' },
      { text: 'B.I.G.', kind: 'text' },
    ])
  })
  it('names other space characters and zero-width ones', () => {
    expect(spaceKind(' ')).toEqual({ kind: 'other', name: 'U+00A0 NO-BREAK SPACE' })
    expect(spaceKind('\t')).toEqual({ kind: 'other', name: 'U+0009 TAB' })
    expect(spaceKind('　')).toEqual({ kind: 'other', name: 'U+3000 IDEOGRAPHIC SPACE' })
    for (let c = 0x2000; c <= 0x200a; c++) expect(spaceKind(String.fromCharCode(c)).kind).toBe('other')
    expect(spaceKind(' ').kind).toBe('other')
    expect(spaceKind(' ').kind).toBe('other')
    expect(spaceKind('​')).toEqual({ kind: 'invisible', name: 'U+200B ZERO WIDTH SPACE' })
    expect(spaceKind('﻿').kind).toBe('invisible')
    expect(spaceKind('a')).toEqual({ kind: 'text' })
    expect(spaceKind('\n')).toEqual({ kind: 'text' })
  })
  it('joins back to the same text, astral characters included', () => {
    for (const t of ['', 'abc', ' lead', 'trail ', 'A B​C\tD 😀 E', '   ']) expect(splitSpaces(t).map((s) => s.text).join('')).toBe(t)
    expect(splitSpaces('😀 x')).toEqual([{ text: '😀', kind: 'text' }, { text: ' ', kind: 'space' }, { text: 'x', kind: 'text' }])
  })
  it('styles spaces and the others apart', () => {
    expect(SPACE_CLASS.space).toBe('ws')
    expect(SPACE_CLASS.other).toContain('ws-other')
    expect(SPACE_CLASS.text).toBe('')
  })
  it('is off by default, and older saved settings get it off', () => {
    expect(DEFAULT_VIEW.spaces).toBe(false)
    expect(parseView('{"numbers":true}').spaces).toBe(false)
    expect(parseView('{"spaces":true}').spaces).toBe(true)
    expect(parseView('{"spaces":"yes"}').spaces).toBe(false)
  })
})
