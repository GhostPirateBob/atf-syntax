import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { tagsFromMediaInfo, type MediaInfoJson } from './mediainfo'
import { analyze, loadVuio } from './vuio'

const module = loadVuio(readFileSync(new URL('../wasm/vuio_media_info.wasm', import.meta.url)))

const synchsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]

/** An ID3v2.3-tagged MP3: text frames, a `pad`-byte picture, then `frames` 128 kb/s 44.1 kHz frames. */
function mp3(tags: Record<string, string>, frames: number, pad = 0): Uint8Array {
  const parts: Uint8Array[] = []
  const frame = (id: string, data: Uint8Array) => {
    const header = [...id].map((c) => c.charCodeAt(0)).concat([24, 16, 8, 0].map((s) => (data.length >>> s) & 0xff), [0, 0])
    parts.push(Uint8Array.from(header), data)
  }
  for (const [id, text] of Object.entries(tags)) frame(id, Uint8Array.from([0, ...new TextEncoder().encode(text)]))
  if (pad) frame('APIC', new Uint8Array(pad))
  const bodyLength = parts.reduce((n, p) => n + p.length, 0)
  const audioFrame = new Uint8Array(417)
  audioFrame.set([0xff, 0xfb, 0x90, 0x00])
  const all = [Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, ...synchsafe(bodyLength)]), ...parts, ...Array.from({ length: frames }, () => audioFrame)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Runs the reader over in-memory bytes, counting what it read. */
function read(bytes: Uint8Array) {
  let read = 0
  return {
    json: async () =>
      analyze(await module, bytes.length, (offset, length) => {
        read += length
        return bytes.subarray(offset, offset + length)
      }),
    get bytesRead() {
      return read
    },
  }
}

describe('vuio', () => {
  it('reads an MP3 into the ATF tags the page shows', async () => {
    const file = mp3({ TIT2: 'Big Dawgs', TPE1: 'Hanumankind', TRCK: '03/12', TCON: '(7)' }, 1000)
    const tags = tagsFromMediaInfo(JSON.parse(await read(file).json()) as MediaInfoJson, 'x.mp3')
    expect(tags).toMatchObject({
      title: 'Big Dawgs',
      artist: 'Hanumankind',
      tracknumber: '3',
      genre: 'Hip-Hop',
      bitrate: '128',
      samplerate: '44100',
      vbr: '0',
      type: '0',
      length_seconds: String(Math.round((1000 * 1152) / 44100)),
    })
  })

  it('reads only the head and tail of a big file, plus a tag too big for the head', async () => {
    // A 600 KB cover in the ID3 tag pushes the first audio frame past the head.
    const file = mp3({ TIT2: 'Covered' }, 5000, 600 * 1024)
    const reader = read(file)
    const tags = tagsFromMediaInfo(JSON.parse(await reader.json()) as MediaInfoJson, 'x.mp3')
    expect(tags.title).toBe('Covered')
    expect(tags.samplerate).toBe('44100')
    expect(reader.bytesRead).toBeLessThan(file.length)
  })

  it("throws the module's message for a file it can't read", async () => {
    await expect(read(new TextEncoder().encode('just some text, not audio')).json()).rejects.toThrow(/Unrecognized/)
  })
})
