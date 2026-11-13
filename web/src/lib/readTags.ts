// Reads tags from the user's own audio files with MediaInfo.js (MediaInfoLib compiled to
// WebAssembly, BSD-2-Clause). App imports this module only when files arrive, so neither the
// library nor its .wasm is part of the page until then. Files are read in chunks with Blob.slice,
// so a large FLAC is never loaded whole, and nothing leaves the browser.
import mediaInfoFactory, { type MediaInfo } from 'mediainfo.js'
import wasmUrl from 'mediainfo.js/MediaInfoModule.wasm?url'
import { tagsFromMediaInfo, type MediaInfoJson } from './mediainfo'

let instance: Promise<MediaInfo<'JSON'>> | undefined
let queue: Promise<unknown> = Promise.resolve()

/** The shared MediaInfo instance. The first call fetches and compiles the .wasm. */
export function ready(): Promise<MediaInfo<'JSON'>> {
  instance ??= mediaInfoFactory({ format: 'JSON', locateFile: () => wasmUrl }).catch((e: unknown) => {
    instance = undefined
    throw e
  })
  return instance
}

/**
 * ATF tags for one audio file, via the same mediainfo JSON the sample tracks ship as. `path` is
 * all the page knows of where the file lives: a path relative to the picked folder, or the bare name.
 */
export function readTags(file: Blob, path: string): Promise<Record<string, string>> {
  // One instance analyses one file at a time, so calls queue up behind each other.
  const run = queue.then(async () => {
    const mediainfo = await ready()
    const json = await mediainfo.analyzeData(file.size, async (size, offset) => new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()))
    return tagsFromMediaInfo(JSON.parse(json) as MediaInfoJson, path)
  })
  queue = run.catch(() => undefined)
  return run
}
