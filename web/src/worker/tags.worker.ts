/// <reference lib="webworker" />
// Reads tags from the user's own audio files with MediaInfo.js (MediaInfoLib compiled to
// WebAssembly, BSD-2-Clause), off the main thread: MediaInfo walks an MP3's frames for its length
// and bitrate, about 100 ms of solid work a file (seconds for an odd one), which on the page would
// freeze typing and scrolling. lib/readTags.ts runs a few of these side by side. Files are read in
// chunks (FileReaderSync over Blob.slice), so a large FLAC is never loaded whole, and nothing leaves
// the browser.
import mediaInfoFactory, { type MediaInfo } from 'mediainfo.js'
import wasmUrl from 'mediainfo.js/MediaInfoModule.wasm?url'
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
// Files can arrive before MediaInfo has loaded: each read waits for it. JSON, not 'object': the
// object output turns number-like tags into numbers, so a track number written 0125 would read 125.
const loading: Promise<MediaInfo<'JSON'>> = mediaInfoFactory({ format: 'JSON', locateFile: () => wasmUrl })
loading.then(
  () => postMessage({ type: 'ready' } satisfies TagsResponse),
  (e: unknown) => postMessage({ type: 'failed', message: String(e) } satisfies TagsResponse),
)

self.onmessage = async ({ data }: MessageEvent<TagsRequest>) => {
  const { id, file, path } = data
  try {
    const mediainfo = await loading
    const json = await mediainfo.analyzeData(file.size, (size, offset) => new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + size))))
    postMessage({ id, tags: tagsFromMediaInfo(JSON.parse(json) as MediaInfoJson, path) } satisfies TagsResponse)
  } catch (e) {
    postMessage({ id, error: String(e) } satisfies TagsResponse)
  }
}
