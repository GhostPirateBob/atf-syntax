import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import throttle from 'lodash-es/throttle'
import { frames } from './timing'

describe('frames', () => {
  it('gives n frames at 60 Hz in ms, each computed from n', () => {
    expect(frames(1)).toBe(16.66667)
    expect(frames(2)).toBe(33.33333)
    expect(frames(3)).toBe(50)
    expect(frames(6)).toBe(100)
  })
})

describe('throttle wiring (leading and trailing, as the mousemove and resize handlers use it)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('answers the first call at once and always applies the last one', () => {
    const seen: number[] = []
    const onMove = throttle((x: number) => seen.push(x), frames(1), { leading: true, trailing: true })
    onMove(1)
    expect(seen).toEqual([1])
    onMove(2)
    onMove(3)
    expect(seen).toEqual([1])
    // (The fake clock counts whole ms, so the 16.67 ms wait ends at 17.)
    vi.advanceTimersByTime(Math.ceil(frames(1)))
    expect(seen).toEqual([1, 3])
  })

  it('takes resizes at most every two frames, ending on the final size', () => {
    let width = 0
    let latest = 0
    let applied = 0
    const apply = throttle(() => ((width = latest), applied++), frames(2), { leading: true, trailing: true })
    const observe = (w: number) => {
      latest = w
      apply()
    }
    observe(100)
    expect(width).toBe(100)
    for (let w = 101; w <= 140; w++) {
      vi.advanceTimersByTime(4)
      observe(w)
    }
    vi.advanceTimersByTime(Math.ceil(frames(2)))
    expect(width).toBe(140)
    // 41 resizes over 160 ms, applied once per 33 ms window, not 41 times.
    expect(applied).toBeLessThanOrEqual(7)
  })

  it('does nothing after cancel (as on unmount)', () => {
    const seen: number[] = []
    const onMove = throttle((x: number) => seen.push(x), frames(1), { leading: true, trailing: true })
    onMove(1)
    onMove(2)
    onMove.cancel()
    vi.advanceTimersByTime(100)
    expect(seen).toEqual([1])
  })
})
