import { describe, expect, it } from 'vitest'
import { GLYPH_ROWS, TICKER_MAX_CHARS, TICKER_MIN_GAP, glyphCell, tickerGap, nextStep, stripOffset, tickerChars, tickerStrip, totalAdvance, type TickerItem } from './ticker'
import { DEFAULT_TICKER_METRICS, cleanMetrics, parseTickerFont, presetForMetrics, presetForSheet } from './tickerFont'

const mono = (s: string, w = 9): TickerItem[] => Array.from(s).map((ch) => ({ ch, advance: w }))
const text = (items: TickerItem[]) => items.map((i) => i.ch).join('')

describe('bitmap font glyph map', () => {
  it("follows classic text.bmp's order: letters, digits and punctuation, then Å Ö Ä ? *", () => {
    expect(glyphCell('A')).toEqual({ row: 0, col: 0 })
    expect(glyphCell('Z')).toEqual({ row: 0, col: 25 })
    expect(glyphCell('"')).toEqual({ row: 0, col: 26 })
    expect(glyphCell('@')).toEqual({ row: 0, col: 27 })
    expect(glyphCell('0')).toEqual({ row: 1, col: 0 })
    expect(glyphCell('9')).toEqual({ row: 1, col: 9 })
    expect(glyphCell('…')).toEqual({ row: 1, col: 10 })
    expect(glyphCell('.')).toEqual({ row: 1, col: 11 })
    expect(glyphCell(':')).toEqual({ row: 1, col: 12 })
    expect(glyphCell('(')).toEqual({ row: 1, col: 13 })
    expect(glyphCell(')')).toEqual({ row: 1, col: 14 })
    expect(glyphCell('-')).toEqual({ row: 1, col: 15 })
    expect(glyphCell("'")).toEqual({ row: 1, col: 16 })
    expect(glyphCell('\\')).toEqual({ row: 1, col: 20 })
    expect(glyphCell('/')).toEqual({ row: 1, col: 21 })
    expect(glyphCell('&')).toEqual({ row: 1, col: 25 })
    expect(glyphCell('#')).toEqual({ row: 1, col: 30 })
    expect(glyphCell('Å')).toEqual({ row: 2, col: 0 })
    expect(glyphCell('Ö')).toEqual({ row: 2, col: 1 })
    expect(glyphCell('Ä')).toEqual({ row: 2, col: 2 })
    expect(glyphCell('?')).toEqual({ row: 2, col: 3 })
    expect(glyphCell('*')).toEqual({ row: 2, col: 4 })
  })
  it('fits a 31-column, 3-row sheet', () => {
    expect(GLYPH_ROWS.map((r) => Array.from(r).length)).toEqual([28, 31, 5])
  })
  it('draws lower case with the capitals, and accented letters without their accent', () => {
    expect(glyphCell('a')).toEqual(glyphCell('A'))
    expect(glyphCell('z')).toEqual(glyphCell('Z'))
    expect(glyphCell('ö')).toEqual({ row: 2, col: 1 })
    expect(glyphCell('é')).toEqual(glyphCell('E'))
    expect(glyphCell('Ñ')).toEqual(glyphCell('N'))
  })
  it('uses look-alikes for missing brackets, quotes and dashes', () => {
    expect(glyphCell('<')).toEqual(glyphCell('['))
    expect(glyphCell('}')).toEqual(glyphCell(']'))
    expect(glyphCell('’')).toEqual(glyphCell("'"))
    expect(glyphCell('“')).toEqual(glyphCell('"'))
    expect(glyphCell('—')).toEqual(glyphCell('-'))
  })
  it('leaves a space, and anything without a glyph, blank', () => {
    for (const ch of [' ', '~', ';', '|', 'ß', '日', '😀', '\t']) expect(glyphCell(ch), ch).toBeNull()
  })
})

describe('ticker steps', () => {
  it('pads a short title with spaces to fill the box, and a long one with at least the minimum gap', () => {
    // 'JAY-Z - Oceans 3:58' is 19 glyphs of 9 px (171 px) in a 360 px box: 21 spaces make 360.
    expect(tickerGap(171, 360, 9)).toBe(21)
    expect(tickerGap(171, 364, 9)).toBe(22) // rounded up: the unit always covers the box
    expect(tickerGap(900, 360, 9)).toBe(TICKER_MIN_GAP)
    expect(tickerGap(171, 360, 0)).toBe(TICKER_MIN_GAP)
    const unit = mono(`JAY-Z - Oceans 3:58${' '.repeat(tickerGap(171, 360, 9))}`)
    expect(totalAdvance(unit)).toBe(360)
    // The title appears once per unit, so a box-wide window never shows it twice.
    expect(text(unit).split('JAY-Z').length - 1).toBe(1)
  })
  it('loops on the text then its gap', () => {
    const unit = mono(`Dogs${' '.repeat(TICKER_MIN_GAP)}`)
    expect(nextStep(0, unit.length)).toBe(1)
    expect(nextStep(unit.length - 1, unit.length)).toBe(0)
    expect(nextStep(5, 0)).toBe(0)
  })
  it('moves left exactly one glyph per step', () => {
    const unit = mono('ABCDE', 9)
    expect([0, 1, 2, 4].map((s) => stripOffset(unit, s))).toEqual([0, 9, 18, 36])
    // Proportional advances (a fallback glyph): each step moves by the one character scrolled off.
    const mixed: TickerItem[] = [{ ch: 'A', advance: 9 }, { ch: '日', advance: 16 }, { ch: 'B', advance: 9 }]
    expect([0, 1, 2, 3].map((s) => stripOffset(mixed, s))).toEqual([0, 9, 25, 34])
  })
  it('repeats the unit enough that the line never runs out, and wraps seamlessly', () => {
    const unit = mono(`Pink Floyd - Dogs${" ".repeat(TICKER_MIN_GAP)}`)
    const width = totalAdvance(unit)
    for (const visible of [50, width - 1, width, width * 2.5]) {
      const strip = tickerStrip(unit, visible)
      expect(strip.length % unit.length).toBe(0)
      // From the last step of a loop, the whole box is still covered.
      expect(totalAdvance(strip) - stripOffset(unit, unit.length - 1)).toBeGreaterThanOrEqual(visible)
    }
    // One more step after the last one lands where step 0 does, a whole unit along the same strip.
    const strip = tickerStrip(unit, 100)
    const last = unit.length - 1
    expect(stripOffset(unit, last) + unit[last]!.advance).toBe(width)
    expect(text(strip.slice(unit.length, unit.length * 2))).toBe(text(unit))
  })
  it('counts characters by code point and caps very long titles', () => {
    expect(tickerChars('a😀b')).toEqual(['a', '😀', 'b'])
    expect(tickerChars('x'.repeat(TICKER_MAX_CHARS + 50))).toHaveLength(TICKER_MAX_CHARS)
  })
})

describe('skin ticker font settings', () => {
  const font = { dataUrl: 'data:image/png;base64,AAAA', name: 'Songtickerfont.png', charWidth: 10, charHeight: 22, hspacing: -1 }
  it('reads back what was stored, and nothing from junk', () => {
    expect(parseTickerFont(JSON.stringify(font))).toEqual(font)
    for (const raw of [null, '', '{', '[]', '"x"', JSON.stringify({ ...font, dataUrl: 'https://example.com/a.png' }), JSON.stringify({ ...font, charWidth: 0 })]) {
      expect(parseTickerFont(raw), String(raw)).toBeNull()
    }
  })
  it('keeps metrics in range, with a positive advance', () => {
    expect(cleanMetrics({ charWidth: 7, charHeight: 12, hspacing: -1 })).toEqual({ charWidth: 7, charHeight: 12, hspacing: -1 })
    expect(cleanMetrics({ charWidth: 2, charHeight: 12, hspacing: -2 })).toBeUndefined()
    expect(cleanMetrics({ charWidth: 1.5, charHeight: 12, hspacing: 0 })).toBeUndefined()
    expect(cleanMetrics({ charWidth: 10, charHeight: 99, hspacing: 0 })).toBeUndefined()
  })
  it("knows Winamp Modern's two sheets", () => {
    expect(presetForSheet(320, 66)?.metrics).toEqual({ charWidth: 10, charHeight: 22, hspacing: -1 })
    expect(presetForSheet(300, 40)?.metrics).toEqual({ charWidth: 7, charHeight: 12, hspacing: -1 })
    expect(presetForSheet(155, 18)).toBeUndefined()
    expect(presetForMetrics(DEFAULT_TICKER_METRICS)?.id).toBe('player')
    expect(presetForMetrics({ charWidth: 5, charHeight: 6, hspacing: 0 })).toBeUndefined()
  })
})
