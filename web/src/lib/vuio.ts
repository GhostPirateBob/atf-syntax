// vuio-media-info's WebAssembly tag reader (Rust; built into src/wasm/ by
// scripts/build-vuio-wasm.mjs): an audio or video file to MediaInfo-style JSON, the same JSON
// lib/mediainfo.ts turns into ATF tags. It reads a file a range at a time: the head and the
// tail, then only what a parser asks for (an ID3 tag holding a big cover, an MP4's moov at the
// end), never the audio in between, so a 40 MB FLAC costs a few hundred KB of reading.
// Pure: the worker supplies the bytes, so the tests can run it in Node.

/** The module's exports: a plain C ABI (vuio-media-info's wasm/src/lib.rs), no imports. */
export interface VuioModule {
  memory: WebAssembly.Memory
  vmi_abi_version(): number
  vmi_begin(size: bigint): void
  vmi_range(offset: bigint, length: number): number
  vmi_inspect(): number
  vmi_need_offset(): bigint
  vmi_need_len(): bigint
  vmi_result_ptr(): number
  vmi_result_len(): number
  vmi_end(): void
}

/** The ABI this file speaks; the module says which it has. */
export const ABI_VERSION = 1

/** Read up front: tags and stream headers are nearly always in the first 256 KB and the last 128 KB. */
const HEAD = 256 * 1024
const TAIL = 128 * 1024
/** A range the module asks for is read at least this big, so a box header and its body come together. */
const MIN_READ = 64 * 1024
/** A file asking for more than this many ranges is given up on. */
const MAX_ROUNDS = 32

/** `length` bytes of the file at `offset` (fewer only at its end). Synchronous: FileReaderSync in the worker. */
export type ReadChunk = (offset: number, length: number) => Uint8Array

/** Instantiates the module from its bytes, or from a fetch of the .wasm (compiled as it downloads). */
export async function loadVuio(source: BufferSource | Promise<Response>): Promise<VuioModule> {
  let instance: WebAssembly.Instance
  if (source instanceof Promise) {
    const response = await source
    if (!response.ok) throw new Error(`Couldn't load the tag reader (${response.status})`)
    try {
      instance = (await WebAssembly.instantiateStreaming(response.clone(), {})).instance
    } catch {
      // A server that doesn't say application/wasm: compile from the bytes instead.
      instance = (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance
    }
  } else {
    instance = (await WebAssembly.instantiate(source, {})).instance
  }
  const m = instance.exports as unknown as VuioModule
  if (m.vmi_abi_version() !== ABI_VERSION) throw new Error(`Tag reader ABI ${m.vmi_abi_version()}, expected ${ABI_VERSION}`)
  return m
}

const utf8 = new TextDecoder()

/**
 * The file's MediaInfo-style JSON. Throws the module's message for a file it can't read. A
 * `WebAssembly.RuntimeError` means the module trapped (a bug in it): load a fresh one.
 */
export function analyze(m: VuioModule, size: number, read: ReadChunk): string {
  const supply = (offset: number, length: number) => {
    const len = Math.min(length, size - offset)
    if (len <= 0) return
    const bytes = read(offset, len)
    // vmi_range may grow the memory, which replaces memory.buffer: view it afterwards.
    const ptr = m.vmi_range(BigInt(offset), bytes.length)
    new Uint8Array(m.memory.buffer, ptr, bytes.length).set(bytes)
  }

  m.vmi_begin(BigInt(size))
  try {
    if (size <= HEAD + TAIL) supply(0, size)
    else {
      supply(0, HEAD)
      supply(size - TAIL, TAIL)
    }
    for (let round = 0; ; round++) {
      const code = m.vmi_inspect()
      if (code === 2 && round < MAX_ROUNDS) {
        supply(Number(m.vmi_need_offset()), Math.max(Number(m.vmi_need_len()), MIN_READ))
        continue
      }
      const text = utf8.decode(new Uint8Array(m.memory.buffer, m.vmi_result_ptr(), m.vmi_result_len()))
      if (code === 0) return text
      throw new Error(code === 2 ? 'The file asked for too many reads' : text)
    }
  } finally {
    m.vmi_end()
  }
}
