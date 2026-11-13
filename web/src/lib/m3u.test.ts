import { describe, expect, it } from 'vitest'
import { exportTitle, parseM3u, toM3u8, type ExportRow } from './m3u'

const row = (r: Partial<ExportRow> & { filename: string }): ExportRow => ({ text: '', state: 'ok', ...r })
const bytes = (s: string) => [...new TextEncoder().encode(s)]

describe('toM3u8', () => {
  it("writes WACUP's winamp.m3u8 format: UTF-8 BOM, #EXTM3U, #EXTINF:<s>,<title> then the path, LF endings", () => {
    const out = toM3u8([
      row({ filename: 'D:\\Music\\DMX\\Grand Champ\\07 DMX - Shot Down.mp3', lengthSeconds: '223', text: '.  ⇢  DMX ▸ Grand Champ ▹ Shot Down' }),
      row({ filename: 'D:\\Music\\DMX\\Grand Champ\\06 DMX - Come Prepared (skit).mp3', lengthSeconds: 35, text: 'Come Prepared (skit)' }),
    ])
    // Byte for byte, the shape of a playlist WACUP 1.99.57 wrote: EF BB BF, LF only, a final LF.
    expect(bytes(out).slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
    expect(out).not.toContain('\r')
    expect(out).toBe(
      '\uFEFF#EXTM3U\n' +
        '#EXTINF:223,.  ⇢  DMX ▸ Grand Champ ▹ Shot Down\n' +
        'D:\\Music\\DMX\\Grand Champ\\07 DMX - Shot Down.mp3\n' +
        '#EXTINF:35,Come Prepared (skit)\n' +
        'D:\\Music\\DMX\\Grand Champ\\06 DMX - Come Prepared (skit).mp3\n',
    )
  })

  it('reads back as the same entries', () => {
    const rows = [row({ filename: 'D:\\a\\01 x.mp3', lengthSeconds: '61', text: 'X' }), row({ filename: 'D:\\a\\02 y.flac', text: 'Y, with a comma' })]
    expect(parseM3u(toM3u8(rows))).toEqual([
      { filename: 'D:\\a\\01 x.mp3', lengthSeconds: 61, cachedTitle: 'X' },
      { filename: 'D:\\a\\02 y.flac', cachedTitle: 'Y, with a comma' },
    ])
  })

  it('gives -1 seconds when the length is unknown, and rounds the rest', () => {
    const lines = toM3u8([
      row({ filename: 'a.mp3', text: 'a' }),
      row({ filename: 'b.mp3', text: 'b', lengthSeconds: '' }),
      row({ filename: 'c.mp3', text: 'c', lengthSeconds: 'n/a' }),
      row({ filename: 'd.mp3', text: 'd', lengthSeconds: '-1' }),
      row({ filename: 'e.mp3', text: 'e', lengthSeconds: '222.6' }),
    ]).split('\n')
    expect(lines.filter((l) => l.startsWith('#EXTINF'))).toEqual(['#EXTINF:-1,a', '#EXTINF:-1,b', '#EXTINF:-1,c', '#EXTINF:-1,d', '#EXTINF:223,e'])
  })

  it('flattens CR and LF in titles, so each EXTINF stays one line', () => {
    const out = toM3u8([row({ filename: 'a.mp3', text: 'one\r\ntwo\nthree' }), row({ filename: 'b.mp3', state: 'freeze', cachedTitle: 'old\rcached' })])
    expect(out.split('\n')).toEqual(['\uFEFF#EXTM3U', '#EXTINF:-1,one  two three', 'a.mp3', '#EXTINF:-1,old cached', 'b.mp3', ''])
  })

  it('writes no rendered title for rows that would freeze, are too heavy, timed out or are pending: the cached title, else the file name', () => {
    const rows: ExportRow[] = [
      row({ filename: 'D:\\m\\01 Freeze.mp3', state: 'freeze', text: 'ignored', cachedTitle: 'Cached freeze' }),
      row({ filename: 'D:\\m\\02 Pending.mp3', state: 'pending' }),
      row({ filename: 'D:/m/03 Heavy.mp3', state: 'heavy', cachedTitle: '' }),
      row({ filename: 'D:\\m\\04 Timeout.mp3', state: 'timeout', cachedTitle: 'Cached timeout' }),
      row({ filename: 'D:\\m\\05 Empty.mp3', state: 'ok', text: '' }),
      row({ filename: 'D:\\m\\06 Error.mp3', state: 'error', text: '[SYNTAX ERROR IN FORMATTING STRING (3)]', cachedTitle: 'Cached' }),
    ]
    const titles = toM3u8(rows).split('\n').filter((l) => l.startsWith('#EXTINF'))
    expect(titles).toEqual([
      '#EXTINF:-1,Cached freeze',
      '#EXTINF:-1,02 Pending.mp3',
      '#EXTINF:-1,03 Heavy.mp3',
      '#EXTINF:-1,Cached timeout',
      '#EXTINF:-1,05 Empty.mp3',
      // A syntax error is what WACUP itself shows, so it's written as is.
      '#EXTINF:-1,[SYNTAX ERROR IN FORMATTING STRING (3)]',
    ])
    expect(rows.map((r) => exportTitle(r).fallback)).toEqual([true, true, true, true, true, false])
    expect(rows.map((r) => exportTitle(r).reason)).toEqual(['blocked', 'blocked', 'blocked', 'blocked', 'empty', undefined])
  })

  it('writes paths exactly as imported', () => {
    const paths = ['D:\\__MUSIC\\Ärzte\\Café ★ 日本\\01 Intro.mp3', 'D:/forward/slashes.mp3', '\\\\nas\\share\\x.flac', 'http://stream.example/radio', 'relative\\file.mp3']
    const out = toM3u8(paths.map((filename) => row({ filename, text: 't' })))
    expect(out.split('\n').filter((_, i) => i > 0 && i % 2 === 0)).toEqual(paths)
  })
})
