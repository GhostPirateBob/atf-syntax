import type { EvalResult } from '@core/evaluate'

/** Tracks per message from the worker, at most. */
export const CHUNK_SIZE = 200
/** How long the worker evaluates before it reports what it has (and checks for a newer request), in ms. */
export const SLICE_MS = 50

/**
 * The order to evaluate a playlist in: the tracks in `first` (the selected one and those on screen;
 * out-of-range and repeated indices are skipped), then every other track in playlist order.
 */
export function evalOrder(count: number, first: readonly number[] = []): number[] {
  const seen = new Uint8Array(count)
  const order: number[] = []
  for (const i of first) {
    if (Number.isInteger(i) && i >= 0 && i < count && !seen[i]) {
      seen[i] = 1
      order.push(i)
    }
  }
  for (let i = 0; i < count; i++) if (!seen[i]) order.push(i)
  return order
}

export interface Chunk {
  /** [track index, result] pairs, in evaluation order. */
  items: [number, EvalResult][]
  /** True on the last chunk of the run. */
  done: boolean
}

/**
 * One run through a playlist, a slice at a time. Each `next()` evaluates tracks until it has
 * `chunkSize` of them, or `sliceMs` has passed (always at least one track), and returns them. The
 * first slice also ends as soon as the `priority` tracks at the front of the order are done, so
 * they show without waiting for the rest. Between slices the worker yields, so a newer request can
 * replace the run, and each slice reports progress: the page's time limit then covers a single track.
 */
export function createJob(opts: {
  order: readonly number[]
  priority: number
  evaluate: (index: number) => EvalResult
  chunkSize?: number
  sliceMs?: number
  now?: () => number
}): { next(): Chunk } {
  const { order, priority, evaluate } = opts
  const chunkSize = Math.max(1, opts.chunkSize ?? CHUNK_SIZE)
  const sliceMs = opts.sliceMs ?? SLICE_MS
  const now = opts.now ?? (() => performance.now())
  let pos = 0
  return {
    next() {
      const items: [number, EvalResult][] = []
      const started = now()
      const stopAt = pos < priority ? Math.min(priority, order.length) : order.length
      while (pos < stopAt) {
        const index = order[pos++]!
        items.push([index, evaluate(index)])
        if (items.length >= chunkSize || now() - started >= sliceMs) break
      }
      return { items, done: pos >= order.length }
    },
  }
}
