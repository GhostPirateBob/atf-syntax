import { describe, expect, it } from 'vitest'
import { spaceKind } from './whitespace'
import { DEFAULT_VIEW, parseView } from './view'

describe('Show spaces', () => {
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
  it('is on by default, older saved settings without it get it on, and a saved choice is kept', () => {
    expect(DEFAULT_VIEW.spaces).toBe(true)
    expect(parseView('{"numbers":true}').spaces).toBe(true)
    expect(parseView('{"spaces":false}').spaces).toBe(false)
    expect(parseView('{"spaces":"yes"}').spaces).toBe(true)
  })
})
