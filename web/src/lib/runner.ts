import type { EvalResult } from '@core/evaluate'
import type { EvalRequest, EvalResponse } from '@/worker/evaluate.worker'

export type RunOutcome =
  | { kind: 'ok'; results: EvalResult[]; ms: number }
  | { kind: 'timeout'; ms: number }
  | { kind: 'failed'; message: string }

/**
 * Evaluates formats in a Web Worker with a time limit. When a run times out, the worker is
 * terminated and replaced, so a runaway format costs one thread, not the tab. Only the newest
 * request matters: older pending ones resolve as superseded and are ignored by the caller.
 */
export class EvalRunner {
  private worker: Worker | undefined
  private nextId = 1
  private pending = new Map<number, (outcome: RunOutcome) => void>()

  constructor(private readonly timeoutMs = 1000) {}

  run(format: string, tracks: Record<string, string>[]): Promise<RunOutcome> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    const started = performance.now()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.restart()
        resolve({ kind: 'timeout', ms: performance.now() - started })
      }, this.timeoutMs)
      this.pending.set(id, (outcome) => {
        clearTimeout(timer)
        resolve(outcome.kind === 'ok' ? { ...outcome, ms: performance.now() - started } : outcome)
      })
      worker.postMessage({ id, format, tracks } satisfies EvalRequest)
    })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = undefined
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('../worker/evaluate.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<EvalResponse>) => {
      const done = this.pending.get(event.data.id)
      this.pending.delete(event.data.id)
      done?.({ kind: 'ok', results: event.data.results, ms: 0 })
    }
    worker.onerror = (event) => {
      event.preventDefault()
      const message = event.message || 'The evaluator failed to load.'
      for (const done of this.pending.values()) done({ kind: 'failed', message })
      this.pending.clear()
      this.restart()
    }
    this.worker = worker
    return worker
  }

  private restart(): void {
    this.worker?.terminate()
    this.worker = undefined
  }
}
