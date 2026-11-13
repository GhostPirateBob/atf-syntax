/// <reference lib="webworker" />
import { evaluate, type EvalResult } from '@core/evaluate'

export interface EvalRequest {
  id: number
  format: string
  tracks: Record<string, string>[]
}

export interface EvalResponse {
  id: number
  results: EvalResult[]
}

// Runs off the main thread: if a format ever made the evaluator loop, only this worker hangs,
// and the page kills it after a time limit.
self.onmessage = (event: MessageEvent<EvalRequest>) => {
  const { id, format, tracks } = event.data
  const results = tracks.map((fields) => evaluate(format, fields))
  self.postMessage({ id, results } satisfies EvalResponse)
}
