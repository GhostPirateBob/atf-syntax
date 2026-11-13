import type { EvalResult } from '@core/evaluate'
import type { EvalRequest, EvalResponse } from '@/worker/evaluate.worker'

export type RunOutcome =
  | { kind: 'ok'; results: EvalResult[]; ms: number }
  /** One track didn't finish within the time limit. */
  | { kind: 'timeout'; ms: number }
  | { kind: 'failed'; message: string }
  /** A newer run replaced this one before it finished. */
  | { kind: 'superseded' }

/** What the runner needs of a Worker (a fake one in tests). */
export interface WorkerLike {
  postMessage(message: EvalRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<EvalResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

/** Extra time for a new worker's first answer: its script may still be loading (on a slow phone). */
export const LOAD_GRACE_MS = 5000

const defaultWorker = (): WorkerLike => new Worker(new URL('../worker/evaluate.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike

interface Pending {
  results: EvalResult[]
  started: number
  timer: ReturnType<typeof setTimeout>
  onChunk?: (items: [number, EvalResult][]) => void
  resolve: (outcome: RunOutcome) => void
}

/**
 * Evaluates formats in a Web Worker. The playlist is sent once (`setTracks`), then each run sends
 * just the format; results stream back in chunks, the tracks in `first` before the rest.
 *
 * The time limit is per track, not per run: the worker reports at least every 50 ms (see
 * lib/evalJob.ts), so a silence longer than the limit means one track is stuck. The worker is then
 * terminated and replaced, so a runaway format costs one thread, not the tab. (The evaluator's own
 * freeze detection catches the known WACUP hangs first; this is the safety net.) Only the newest
 * run matters: an older one still going resolves as superseded.
 */
export class EvalRunner {
  private worker: WorkerLike | undefined
  private nextId = 1
  private tracks: Record<string, string>[] = []
  private pending = new Map<number, Pending>()
  /** Whether the current worker has answered yet; until then its script may still be loading. */
  private ready = false

  constructor(
    private readonly timeoutMs = 1000,
    private readonly createWorker: () => WorkerLike = defaultWorker,
  ) {}

  /** The playlist to evaluate, kept by the worker (and sent again to a replacement worker). */
  setTracks(tracks: Record<string, string>[]): void {
    this.tracks = tracks
    this.worker?.postMessage({ type: 'tracks', tracks })
  }

  run(format: string, opts: { first?: number[]; onChunk?: (items: [number, EvalResult][]) => void } = {}): Promise<RunOutcome> {
    for (const [id, p] of this.pending) this.finish(id, p, { kind: 'superseded' })
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve) => {
      const p: Pending = { results: new Array(this.tracks.length), started: performance.now(), timer: undefined!, onChunk: opts.onChunk, resolve }
      this.pending.set(id, p)
      this.arm(id, p)
      worker.postMessage({ type: 'run', id, format, first: opts.first ?? [] })
    })
  }

  dispose(): void {
    for (const [id, p] of this.pending) this.finish(id, p, { kind: 'superseded' })
    this.worker?.terminate()
    this.worker = undefined
  }

  /** (Re)starts run `id`'s watchdog: called when it starts and on each chunk. */
  private arm(id: number, p: Pending): void {
    clearTimeout(p.timer)
    p.timer = setTimeout(
      () => {
        this.finish(id, p, { kind: 'timeout', ms: performance.now() - p.started })
        this.restart()
      },
      this.ready ? this.timeoutMs : this.timeoutMs + LOAD_GRACE_MS,
    )
  }

  private finish(id: number, p: Pending, outcome: RunOutcome): void {
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.resolve(outcome)
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker
    const worker = this.createWorker()
    worker.onmessage = (event) => {
      this.ready = true
      const { id, items, done } = event.data
      const p = this.pending.get(id)
      if (!p) return
      for (const [i, r] of items) p.results[i] = r
      p.onChunk?.(items)
      if (done) this.finish(id, p, { kind: 'ok', results: p.results, ms: performance.now() - p.started })
      else this.arm(id, p)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      const message = event.message || 'The evaluator failed to load.'
      for (const [id, p] of this.pending) this.finish(id, p, { kind: 'failed', message })
      this.restart()
    }
    worker.postMessage({ type: 'tracks', tracks: this.tracks })
    this.worker = worker
    return worker
  }

  private restart(): void {
    this.worker?.terminate()
    this.worker = undefined
    this.ready = false
  }
}
