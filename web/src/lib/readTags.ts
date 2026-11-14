// Reads tags from the user's own audio files with vuio-media-info's wasm, in a small pool of
// workers (see worker/tags.worker.ts): the file reads (FileReaderSync) happen off the page, so a
// slow disk can't freeze typing or scrolling, and side by side a big folder reads faster.
// App imports this module only when files arrive, so neither the reader nor its .wasm is part of
// the page until then. Nothing leaves the browser.
import type { TagsRequest, TagsResponse } from '@/worker/tags.worker'

/** What the pool needs of a Worker (a fake one in tests). */
export interface TagWorker {
  postMessage(message: TagsRequest): void
  terminate(): void
  onmessage: ((e: { data: TagsResponse }) => void) | null
  onerror: ((e: unknown) => void) | null
}

/** 2 to 4 workers: half the logical cores, so the page and the evaluator keep some for themselves. */
export const poolSize = (cores = globalThis.navigator?.hardwareConcurrency || 4) => Math.min(4, Math.max(2, Math.floor(cores / 2)))

interface Job {
  id: number
  file: Blob
  path: string
  resolve: (tags: Record<string, string>) => void
  reject: (e: Error) => void
}
interface Slot {
  worker: TagWorker
  loaded: Promise<void>
  job?: Job
  /** Loaded the tag reader and said so. */
  started?: boolean
  /** Couldn't start (the tag reader or the worker script didn't load): never given work. */
  dead?: boolean
}

/**
 * A pool of tag workers. Each file goes to an idle worker; the rest wait in order. A worker that
 * crashes is replaced, failing only the file it was reading.
 */
export function createTagPool(create: () => TagWorker, size = poolSize()) {
  const slots: Slot[] = []
  const waiting: Job[] = []
  let nextId = 0

  function spawn(): Slot {
    const worker = create()
    const slot: Slot = { worker, loaded: Promise.resolve() }
    slot.loaded = new Promise<void>((resolve, reject) => {
      const fail = (message: string) => {
        slot.dead = true
        worker.terminate()
        reject(new Error(message))
        // A file handed over before it loaded goes back to the front of the queue for another worker.
        if (slot.job) waiting.unshift(slot.job)
        slot.job = undefined
        pump()
      }
      worker.onmessage = ({ data }) => {
        if ('type' in data) {
          if (data.type === 'ready') {
            slot.started = true
            resolve()
          } else fail(data.message)
          return
        }
        const job = slot.job
        if (!job || job.id !== data.id) return
        slot.job = undefined
        if ('tags' in data) job.resolve(data.tags)
        else job.reject(new Error(data.error))
        pump()
      }
      worker.onerror = () => {
        const job = slot.job
        // It never loaded (the script or the tag reader didn't): don't retry it.
        if (!slot.started || !job) return fail('The tag reader failed to start')
        // A crash mid-file: fail that file, replace the worker, carry on with the rest.
        slot.job = undefined
        worker.terminate()
        slots[slots.indexOf(slot)] = spawn()
        job.reject(new Error(`Couldn't read ${job.path}`))
        pump()
      }
    })
    slot.loaded.catch(() => undefined)
    return slot
  }

  function pump() {
    // Every worker failed to start: nothing will ever take the waiting files.
    if (slots.length && slots.every((s) => s.dead)) {
      for (const job of waiting.splice(0)) job.reject(new Error('The tag reader failed to start'))
      return
    }
    for (const slot of slots) {
      if (slot.dead || slot.job || !waiting.length) continue
      const job = waiting.shift()!
      slot.job = job
      slot.worker.postMessage({ id: job.id, file: job.file, path: job.path })
    }
  }

  return {
    size,
    /** Starts the workers and resolves once the first has loaded the tag reader (rejects if it can't). */
    ready(): Promise<void> {
      while (slots.length < size) slots.push(spawn())
      return Promise.any(slots.map((s) => s.loaded)).catch((e: unknown) => {
        throw e instanceof AggregateError ? (e.errors[0] as Error) : e
      })
    },
    /** ATF tags for one audio file. `path` is all the page knows of where it lives. */
    readTags(file: Blob, path: string): Promise<Record<string, string>> {
      while (slots.length < size) slots.push(spawn())
      return new Promise((resolve, reject) => {
        waiting.push({ id: nextId++, file, path, resolve, reject })
        pump()
      })
    },
  }
}

const pool = createTagPool(() => new Worker(new URL('../worker/tags.worker.ts', import.meta.url), { type: 'module' }) as unknown as TagWorker)

/** How many files are read at once. */
export const concurrency = pool.size
export const ready = () => pool.ready()
export const readTags = (file: Blob, path: string) => pool.readTags(file, path)
