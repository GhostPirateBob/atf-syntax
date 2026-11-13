/**
 * `n` frames at 60 Hz, in ms, rounded to 5 decimals: frames(1) = 16.66667, frames(2) = 33.33333,
 * frames(3) = 50. Computed from n each time (not frames(1) * n), so multiples don't add up rounding.
 */
export const frames = (n: number) => Math.round((1000 / 60) * n * 1e5) / 1e5

/** A time slice's budget in ms: half a frame, so a slice and the frame's own work fit in one frame. */
export const SLICE_BUDGET = frames(0.5)

type SchedulerLike = { yield?: () => Promise<void> }
let channel: MessageChannel | undefined
const waiting: (() => void)[] = []

/**
 * Lets the browser paint and handle input before the rest of a long job: `scheduler.yield()` where
 * there is one (it resumes ahead of other tasks), else a message-channel task (setTimeout(0) is
 * clamped to 4 ms after a few nested calls).
 */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: SchedulerLike }).scheduler
  if (typeof s?.yield === 'function') return s.yield()
  return new Promise((resolve) => {
    if (!channel) {
      channel = new MessageChannel()
      channel.port1.onmessage = () => waiting.shift()?.()
    }
    waiting.push(resolve)
    channel.port2.postMessage(null)
  })
}

/**
 * Runs `fn` when the main thread is idle (at most `timeout` ms later), or after `timeout` where
 * requestIdleCallback doesn't exist. Returns a cancel function.
 */
export function whenIdle(fn: () => void, timeout = 2000): () => void {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout })
    return () => w.cancelIdleCallback!(id)
  }
  const id = setTimeout(fn, Math.min(timeout, 200))
  return () => clearTimeout(id)
}
