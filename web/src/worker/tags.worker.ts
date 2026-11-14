/// <reference lib="webworker" />
// Reads tags from the user's own audio files with vuio-media-info (Rust compiled to WebAssembly,
// MIT / Apache-2.0, partly based on MediaInfoLib), off the main thread. It reads only a file's
// head and tail plus whatever range a tag or header turns out to need (FileReaderSync over
// Blob.slice), so a large FLAC is never loaded whole, and nothing leaves the browser.
// lib/readTags.ts runs a few of these side by side.
import { analyze, loadVuio, type VuioModule } from '@/lib/vuio'
import wasmUrl from '@/wasm/vuio_media_info.wasm?url'
import { tagsFromMediaInfo, type MediaInfoJson } from '@/lib/mediainfo'

/** Read one file. `path` is all the page knows of where it lives (relative to the picked folder, or the bare name). */
export interface TagsRequest {
  id: number
  file: Blob
  path: string
}
export type TagsResponse =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { id: number; tags: Record<string, string> }
  | { id: number; error: string }

const reader = new FileReaderSync()
const load = () => loadVuio(fetch(wasmUrl))
// Files can arrive before the module has loaded: each read waits for it.
let loading: Promise<VuioModule> = load()
loading.then(
  () => postMessage({ type: 'ready' } satisfies TagsResponse),
  (e: unknown) => postMessage({ type: 'failed', message: String(e) } satisfies TagsResponse),
)

self.onmessage = async ({ data }: MessageEvent<TagsRequest>) => {
  const { id, file, path } = data
  try {
    const vuio = await loading
    const json = analyze(vuio, file.size, (offset, length) => new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + length))))
    postMessage({ id, tags: tagsFromMediaInfo(JSON.parse(json) as MediaInfoJson, path) } satisfies TagsResponse)
  } catch (e) {
    // A trap leaves the instance in an unknown state: the next file gets a fresh one.
    if (e instanceof WebAssembly.RuntimeError) loading = load()
    postMessage({ id, error: String(e) } satisfies TagsResponse)
  }
}
