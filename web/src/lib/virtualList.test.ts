import { beforeEach, describe, expect, it } from 'vitest'
import { rowOffsets, rowsInView, scrollToShow, visibleWindow } from './virtualList'
import { FIT_CACHE_MAX, clearFitCache, fitCache, fitRow } from './fitCache'

describe('virtualised list maths', () => {
  const even = rowOffsets(2000, () => 40)

  it('sums row heights into offsets', () => {
    expect([...rowOffsets(3, (i) => [10, 25, 5][i]!)]).toEqual([0, 10, 35, 40])
    expect(even[2000]).toBe(80_000)
  })

  it('renders only the rows in view plus the overscan, with spacers for the rest', () => {
    // A 200 px view (five 40 px rows) scrolled to row 100.
    expect(visibleWindow(even, 4000, 200, 3)).toEqual({ start: 97, end: 108, padTop: 97 * 40, padBottom: (2000 - 108) * 40 })
    // At the top and the bottom the overscan is cut at the ends.
    expect(visibleWindow(even, 0, 200, 3)).toMatchObject({ start: 0, end: 8, padTop: 0 })
    expect(visibleWindow(even, 80_000 - 200, 200, 3)).toMatchObject({ start: 1992, end: 2000, padBottom: 0 })
  })

  it('counts a row cut at the top or bottom of the view as in view', () => {
    expect(rowsInView(even, 4020, 200)).toEqual([100, 101, 102, 103, 104, 105])
    expect(rowsInView(even, 4000, 200)).toEqual([100, 101, 102, 103, 104])
  })

  it('handles rows of different heights (an open tag editor)', () => {
    const offsets = rowOffsets(10, (i) => (i === 2 ? 300 : 40))
    // Scrolled into the tall row: it alone fills the view.
    expect(rowsInView(offsets, 100, 200)).toEqual([2])
    expect(visibleWindow(offsets, 100, 200, 1)).toEqual({ start: 1, end: 4, padTop: 40, padBottom: 40 * 6 })
  })

  it('renders a few rows to measure before the view height is known, and nothing for an empty list', () => {
    expect(visibleWindow(even, 0, 0, 2)).toMatchObject({ start: 0, end: 7 })
    expect(visibleWindow(rowOffsets(0, () => 40), 0, 200, 3)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
  })

  it('clamps a scroll position past the end (the list just got shorter)', () => {
    const short = rowOffsets(3, () => 40)
    expect(visibleWindow(short, 5000, 200, 1)).toEqual({ start: 0, end: 3, padTop: 0, padBottom: 0 })
  })

  it('scrolls the least that shows a row whole', () => {
    expect(scrollToShow(even, 102, 4000, 200)).toBe(4000)
    expect(scrollToShow(even, 99, 4000, 200)).toBe(99 * 40)
    expect(scrollToShow(even, 105, 4000, 200)).toBe(106 * 40 - 200)
    expect(scrollToShow(even, 5000, 4000, 200)).toBe(4000)
  })
})

describe('the "..." fit cache', () => {
  // A fake monospace measure: 10 px a character, counting calls.
  let calls = 0
  const measure = (s: string) => (calls++, s.length * 10)
  const opts = { duration: '4:20', prefix: '', width: 200, font: '16px Test', gap: 6 }
  beforeEach(() => {
    calls = 0
    clearFitCache()
  })

  it('measures a title once per font and width, then answers from the cache', () => {
    const first = fitRow('A rather long title that will not fit', opts, measure)
    expect(first.endsWith('...')).toBe(true)
    const measured = calls
    expect(measured).toBeGreaterThan(1)
    expect(fitRow('A rather long title that will not fit', opts, measure)).toBe(first)
    expect(calls).toBe(measured)
  })

  it('measures again when anything that decides the cut changes', () => {
    const title = 'A rather long title that will not fit'
    const narrow = fitRow(title, opts, measure)
    const wide = fitRow(title, { ...opts, width: 300 }, measure)
    expect(wide.length).toBeGreaterThan(narrow.length)
    calls = 0
    fitRow(title, { ...opts, font: '20px Test' }, measure)
    expect(calls).toBeGreaterThan(0)
    calls = 0
    fitRow(title, { ...opts, prefix: '12. ' }, measure)
    expect(calls).toBeGreaterThan(0)
  })

  it('stays bounded', () => {
    for (let i = 0; i < FIT_CACHE_MAX + 10; i++) fitRow(`title ${i}`, opts, measure)
    expect(fitCache.size).toBeLessThanOrEqual(FIT_CACHE_MAX)
  })
})
