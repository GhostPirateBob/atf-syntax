import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvalResult } from '@core/evaluate'
import { createJob, evalOrder } from './evalJob'
import { EvalRunner, LOAD_GRACE_MS, type WorkerLike } from './runner'
import type { EvalRequest, EvalResponse } from '@/worker/evaluate.worker'

const result = (text: string): EvalResult => ({ text, unsure: [] })

describe('evalOrder', () => {
  it('puts the given tracks first, then the rest in playlist order', () => {
    expect(evalOrder(6, [3, 2, 4])).toEqual([3, 2, 4, 0, 1, 5])
  })
  it('skips repeats and indices outside the playlist', () => {
    expect(evalOrder(4, [2, 2, -1, 9, 1.5, 0])).toEqual([2, 0, 1, 3])
    expect(evalOrder(0, [0])).toEqual([])
  })
})

describe('createJob', () => {
  it('reports in chunks of at most chunkSize, covering every track once', () => {
    const job = createJob({ order: evalOrder(450), priority: 0, evaluate: (i) => result(String(i)), chunkSize: 200, sliceMs: 1e9 })
    const sizes: number[] = []
    const seen: number[] = []
    for (;;) {
      const c = job.next()
      sizes.push(c.items.length)
      seen.push(...c.items.map(([i]) => i))
      if (c.done) break
    }
    expect(sizes).toEqual([200, 200, 50])
    expect(seen).toEqual([...Array(450).keys()])
  })

  it('ends the first chunk right after the priority tracks', () => {
    const job = createJob({ order: evalOrder(1000, [500, 501, 499]), priority: 3, evaluate: (i) => result(String(i)), chunkSize: 200, sliceMs: 1e9 })
    const first = job.next()
    expect(first.items.map(([i]) => i)).toEqual([500, 501, 499])
    expect(first.done).toBe(false)
    expect(job.next().items[0]![0]).toBe(0)
  })

  it('ends a chunk once the time slice is used up, after at least one track', () => {
    let clock = 0
    // Each track takes 20 ms: a 50 ms slice holds three (the third crosses the line).
    const job = createJob({ order: evalOrder(10), priority: 0, evaluate: (i) => ((clock += 20), result(String(i))), chunkSize: 200, sliceMs: 50, now: () => clock })
    expect(job.next().items).toHaveLength(3)
    // A single slow track still makes a chunk of one.
    const slow = createJob({ order: evalOrder(2), priority: 0, evaluate: (i) => ((clock += 5000), result(String(i))), sliceMs: 50, now: () => clock })
    expect(slow.next().items).toHaveLength(1)
  })

  it('finishes at once for an empty playlist', () => {
    expect(createJob({ order: [], priority: 0, evaluate: () => result('') }).next()).toEqual({ items: [], done: true })
  })
})

/** A worker the test drives by hand: it records requests and sends chunks when told. */
class FakeWorker implements WorkerLike {
  sent: EvalRequest[] = []
  terminated = false
  onmessage: ((event: MessageEvent<EvalResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage(message: EvalRequest) {
    this.sent.push(message)
  }
  terminate() {
    this.terminated = true
  }
  reply(data: EvalResponse) {
    this.onmessage?.({ data } as MessageEvent<EvalResponse>)
  }
  lastRun() {
    return this.sent.filter((m) => m.type === 'run').at(-1) as Extract<EvalRequest, { type: 'run' }>
  }
}

describe('EvalRunner', () => {
  let workers: FakeWorker[]
  let runner: EvalRunner
  beforeEach(() => {
    vi.useFakeTimers()
    workers = []
    runner = new EvalRunner(1000, () => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    })
  })
  afterEach(() => {
    runner.dispose()
    vi.useRealTimers()
  })

  it('sends the playlist once, then only the format; chunks arrive as they come', async () => {
    runner.setTracks([{ title: 'a' }, { title: 'b' }, { title: 'c' }])
    const chunks: number[][] = []
    const done = runner.run('%title%', { first: [2], onChunk: (items) => chunks.push(items.map(([i]) => i)) })
    const w = workers[0]!
    expect(w.sent.map((m) => m.type)).toEqual(['tracks', 'run'])
    expect(w.lastRun()).toMatchObject({ format: '%title%', first: [2] })
    w.reply({ id: w.lastRun().id, items: [[2, result('c')]], done: false })
    w.reply({ id: w.lastRun().id, items: [[0, result('a')], [1, result('b')]], done: true })
    const outcome = await done
    expect(chunks).toEqual([[2], [0, 1]])
    expect(outcome.kind).toBe('ok')
    expect(outcome.kind === 'ok' && outcome.results.map((r) => r.text)).toEqual(['a', 'b', 'c'])
    void runner.run('x')
    expect(w.sent.map((m) => m.type)).toEqual(['tracks', 'run', 'run'])
  })

  it('applies the time limit per track: a long run that keeps reporting never times out', async () => {
    runner.setTracks(Array.from({ length: 10 }, () => ({})))
    const done = runner.run('f')
    const w = workers[0]!
    const id = w.lastRun().id
    // Ten chunks, 900 ms apart: 9 s in all, but never a second without news.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(i === 0 ? 900 : 900)
      w.reply({ id, items: [[i, result(String(i))]], done: i === 9 })
    }
    expect((await done).kind).toBe('ok')
    expect(w.terminated).toBe(false)
  })

  it('times out when one track takes longer than the limit, and replaces the worker', async () => {
    runner.setTracks([{}, {}, {}])
    const done = runner.run('f')
    const w = workers[0]!
    w.reply({ id: w.lastRun().id, items: [[0, result('a')]], done: false })
    await vi.advanceTimersByTimeAsync(999)
    expect(w.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect((await done).kind).toBe('timeout')
    expect(w.terminated).toBe(true)
    // The next run gets a fresh worker, which is sent the playlist again.
    void runner.run('g')
    expect(workers).toHaveLength(2)
    expect(workers[1]!.sent.map((m) => m.type)).toEqual(['tracks', 'run'])
  })

  it('gives a new worker extra time for its first answer (its script may still be loading)', async () => {
    runner.setTracks([{}])
    const done = runner.run('f')
    await vi.advanceTimersByTimeAsync(1000 + LOAD_GRACE_MS - 1)
    expect(workers[0]!.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect((await done).kind).toBe('timeout')
  })

  it('resolves an older run as superseded when a newer one starts', async () => {
    runner.setTracks([{}])
    const first = runner.run('a')
    const second = runner.run('b')
    expect(await first).toEqual({ kind: 'superseded' })
    const w = workers[0]!
    // A late chunk for the old run is ignored.
    w.reply({ id: 1, items: [[0, result('old')]], done: true })
    w.reply({ id: w.lastRun().id, items: [[0, result('new')]], done: true })
    const outcome = await second
    expect(outcome.kind === 'ok' && outcome.results[0]!.text).toBe('new')
  })
})
