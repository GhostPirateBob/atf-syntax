/// <reference lib="webworker" />
import { evaluate, type EvalResult } from '@core/evaluate'
import { createJob, evalOrder } from '@/lib/evalJob'

/** The playlist, sent once and kept until it changes, so typing only sends the format. */
export interface TracksRequest {
  type: 'tracks'
  tracks: Record<string, string>[]
}
/** Evaluate `format` for every track: those in `first` before the rest. */
export interface RunRequest {
  type: 'run'
  id: number
  format: string
  first: number[]
}
export type EvalRequest = TracksRequest | RunRequest

/** Results so far for run `id`, as [track index, result] pairs; `done` on the last message. */
export interface EvalResponse {
  id: number
  items: [number, EvalResult][]
  done: boolean
}

// Runs off the main thread: if a format ever made the evaluator loop, only this worker hangs,
// and the page kills it after a time limit (see lib/runner.ts).
let tracks: Record<string, string>[] = []
let current: { id: number; next: () => { items: [number, EvalResult][]; done: boolean } } | undefined

// Between slices, yield through a message channel (no setTimeout clamping), so a newer request
// that has arrived replaces the running one.
const channel = new MessageChannel()
channel.port1.onmessage = step

function step() {
  const job = current
  if (!job) return
  const { items, done } = job.next()
  self.postMessage({ id: job.id, items, done } satisfies EvalResponse)
  if (done) current = undefined
  else channel.port2.postMessage(null)
}

self.onmessage = (event: MessageEvent<EvalRequest>) => {
  const msg = event.data
  if (msg.type === 'tracks') {
    tracks = msg.tracks
    return
  }
  const list = tracks
  const order = evalOrder(list.length, msg.first)
  const first = new Set(msg.first.filter((i) => i >= 0 && i < list.length)).size
  const idle = !current
  const job = createJob({ order, priority: first, evaluate: (i) => evaluate(msg.format, list[i]!) })
  current = { id: msg.id, next: job.next }
  if (idle) channel.port2.postMessage(null)
}
