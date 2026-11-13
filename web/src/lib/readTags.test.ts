import { describe, expect, it } from 'vitest'
import type { TagsRequest, TagsResponse } from '@/worker/tags.worker'
import { createTagPool, poolSize, type TagWorker } from './readTags'

/** A fake worker: records what it's asked, and answers when the test says so. */
class FakeWorker implements TagWorker {
  onmessage: ((e: { data: TagsResponse }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  sent: TagsRequest[] = []
  terminated = false
  postMessage(m: TagsRequest) {
    this.sent.push(m)
  }
  terminate() {
    this.terminated = true
  }
  emit(data: TagsResponse) {
    this.onmessage?.({ data })
  }
  answer(tags: Record<string, string>) {
    const job = this.sent[this.sent.length - 1]!
    this.emit({ id: job.id, tags })
  }
}

const setup = (size: number) => {
  const workers: FakeWorker[] = []
  const pool = createTagPool(() => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  }, size)
  return { pool, workers }
}
const file = new Blob(['x'])
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('tag reader pool', () => {
  it('uses 2 to 4 workers: half the cores', () => {
    expect([1, 2, 4, 6, 8, 12, 32].map((c) => poolSize(c))).toEqual([2, 2, 2, 3, 4, 4, 4])
  })

  it('gives each idle worker one file, queues the rest in order, and resolves each with its own tags', async () => {
    const { pool, workers } = setup(2)
    const reads = ['a.mp3', 'b.mp3', 'c.mp3'].map((p) => pool.readTags(file, p))
    expect(workers).toHaveLength(2)
    expect(workers.map((w) => w.sent.map((m) => m.path))).toEqual([['a.mp3'], ['b.mp3']])
    workers[1]!.answer({ title: 'B' })
    // The freed worker takes the next waiting file.
    expect(workers[1]!.sent.map((m) => m.path)).toEqual(['b.mp3', 'c.mp3'])
    workers[0]!.answer({ title: 'A' })
    workers[1]!.answer({ title: 'C' })
    expect(await Promise.all(reads)).toEqual([{ title: 'A' }, { title: 'B' }, { title: 'C' }])
  })

  it('is ready when the first worker has loaded MediaInfo, and fails if none can', async () => {
    const ok = setup(2)
    const ready = ok.pool.ready()
    ok.workers[1]!.emit({ type: 'ready' })
    await expect(ready).resolves.toBeUndefined()

    const bad = setup(2)
    const failing = bad.pool.ready()
    for (const w of bad.workers) w.emit({ type: 'failed', message: 'no wasm' })
    await expect(failing).rejects.toThrow('no wasm')
  })

  it('fails a file MediaInfo rejects, and keeps going', async () => {
    const { pool, workers } = setup(1)
    const bad = pool.readTags(file, 'bad.mp3')
    const good = pool.readTags(file, 'good.mp3')
    workers[0]!.emit({ id: workers[0]!.sent[0]!.id, error: 'unreadable' })
    await expect(bad).rejects.toThrow('unreadable')
    workers[0]!.answer({ title: 'Good' })
    await expect(good).resolves.toEqual({ title: 'Good' })
  })

  it('replaces a worker that crashes mid-file, failing only that file', async () => {
    const { pool, workers } = setup(1)
    const crashed = pool.readTags(file, 'crash.mp3')
    const next = pool.readTags(file, 'next.mp3')
    workers[0]!.emit({ type: 'ready' })
    workers[0]!.onerror?.(new Error('boom'))
    await expect(crashed).rejects.toThrow("Couldn't read crash.mp3")
    expect(workers[0]!.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[1]!.sent.map((m) => m.path)).toEqual(['next.mp3'])
    workers[1]!.answer({ title: 'Next' })
    await expect(next).resolves.toEqual({ title: 'Next' })
  })

  it("moves a file off a worker that never started, and doesn't respawn it", async () => {
    const { pool, workers } = setup(2)
    const a = pool.readTags(file, 'a.mp3')
    const b = pool.readTags(file, 'b.mp3')
    workers[0]!.emit({ type: 'failed', message: 'no wasm' })
    expect(workers).toHaveLength(2) // no respawn
    workers[1]!.emit({ type: 'ready' })
    workers[1]!.answer({ title: 'B' })
    // a.mp3 went back to the queue and the working worker takes it next.
    expect(workers[1]!.sent.map((m) => m.path)).toEqual(['b.mp3', 'a.mp3'])
    workers[1]!.answer({ title: 'A' })
    expect(await Promise.all([a, b])).toEqual([{ title: 'A' }, { title: 'B' }])
  })

  it('fails every file, in flight or waiting, once no worker can start', async () => {
    const { pool, workers } = setup(2)
    const checks = ['a.mp3', 'b.mp3', 'c.mp3'].map((p) => expect(pool.readTags(file, p)).rejects.toThrow('failed to start'))
    workers[0]!.onerror?.(new Error('script 404'))
    workers[1]!.emit({ type: 'failed', message: 'no wasm' })
    await tick()
    expect(workers).toHaveLength(2) // no respawn loop
    await Promise.all(checks)
  })
})
