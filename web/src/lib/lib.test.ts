import { describe, expect, it } from 'vitest'
import { docRange, toFormat } from './document'
import { tokenize } from './tokens'
import { applyDisplay, DEFAULT_DISPLAY } from './display'
import { formatLength, parseM3u } from './m3u'
import { decodeShare, encodeShare } from './share'
import { fieldsFor, tracksFromPlaylist } from './tracks'

describe('toFormat', () => {
  it('joins lines with no separator and skips # comment lines, like .atf files', () => {
    const doc = '# my format\n[%artist% - ]\n%title%'
    const v = toFormat(doc)
    expect(v.format).toBe('[%artist% - ]%title%')
    expect(doc[v.map[0]!]).toBe('[')
    expect(doc[v.map[13]!]).toBe('%')
    expect(v.map[v.format.length]).toBe(doc.length)
  })
  it('maps a format range back to the document', () => {
    const v = toFormat('# c\nab\ncd')
    expect(docRange(v, 1, 3)).toEqual({ from: 5, to: 8 })
  })
})

describe('tokenize', () => {
  const kinds = (s: string) => tokenize(s).map((t) => `${t.kind}:${s.slice(t.start, t.end)}`)
  it('follows WACUP lexical rules', () => {
    expect(kinds("[%artist% - ]$if2(%title%,'(x)')")).toEqual([
      'bracket:[', 'field:%artist%', 'text: - ', 'bracket:]', 'fn:$if2', 'paren:(', 'field:%title%', 'comma:,', "quote:'(x)'", 'paren:)',
    ])
  })
  it('treats a top-level comma as text and recognises escapes', () => {
    expect(kinds("a,b %% $$ ''")).toEqual(['text:a,b ', 'escape:%%', 'text: ', 'escape:$$', 'text: ', "escape:''"])
  })
  it('marks unknown functions and unterminated constructs', () => {
    expect(kinds('$nope(x)')[0]).toBe('fn-unknown:$nope')
    expect(kinds('%artist')).toEqual(['broken:%artist'])
  })
})

describe('applyDisplay', () => {
  it('trims leading whitespace including em spaces, and keeps the load-bearing dot', () => {
    expect(applyDisplay('\u2003  ⇢ x', DEFAULT_DISPLAY)).toBe('⇢ x')
    expect(applyDisplay('.   ⇢ x', DEFAULT_DISPLAY)).toBe('.   ⇢ x')
  })
  it('shows underscores and %20 as spaces only when asked', () => {
    expect(applyDisplay('a_b%20c', DEFAULT_DISPLAY)).toBe('a b c')
    expect(applyDisplay('  a_b%20c', { trimLeading: false, underscoresToSpaces: false, pct20ToSpaces: false })).toBe('  a_b%20c')
  })
})

describe('parseM3u', () => {
  it('reads #EXTINF lengths and cached titles, one entry per path', () => {
    const text = '\uFEFF#EXTM3U\r\n#EXTINF:223,.   ⇢   Some Artist ▸ Album ▹ Song\r\nD:\\Music\\a.m4a\r\nD:\\Music\\b.mp3\r\n#EXTINF:-1,Radio\r\nhttp://stream.example/live\r\n'
    expect(parseM3u(text)).toEqual([
      { filename: 'D:\\Music\\a.m4a', lengthSeconds: 223, cachedTitle: '.   ⇢   Some Artist ▸ Album ▹ Song' },
      { filename: 'D:\\Music\\b.mp3' },
      { filename: 'http://stream.example/live', lengthSeconds: undefined, cachedTitle: 'Radio' },
    ])
  })
  it('formats lengths like a playlist', () => {
    expect(formatLength(223)).toBe('3:43')
    expect(formatLength(3725)).toBe('1:02:05')
  })
})

describe('share links', () => {
  it('round-trip the format and sample', () => {
    const doc = "[%artist% - ]$if2(%title%,$filepart(%filename%)) ⇢ ▸ '100%'"
    expect(decodeShare(encodeShare({ doc, sample: 2 }))).toEqual({ doc, sample: 2 })
  })
  it('carry only the format and sample index, never playlist data', () => {
    const tracks = tracksFromPlaylist(parseM3u('#EXTINF:10,Secret\nC:\\Users\\Joe\\private.mp3'))
    expect(tracks).toHaveLength(1)
    const hash = encodeShare({ doc: '%title%', sample: 1 })
    expect([...new URLSearchParams(hash.slice(1)).keys()]).toEqual(['f', 's'])
    expect(decodeURIComponent(hash)).not.toContain('private')
  })
  it('ignore junk', () => {
    expect(decodeShare('#f=%%%')).toBeUndefined()
    expect(decodeShare('')).toBeUndefined()
  })
})

describe('fieldsFor', () => {
  it('derives %track%, %length%, %folder% and %fullfolder% like WACUP', () => {
    const f = fieldsFor({ id: 'x', source: 'custom', tags: { tracknumber: '2', length_seconds: '193', filename: 'D:\\Music\\A\\B\\02 x.mp3', album: '' } })
    expect(f).toMatchObject({ track: '2', length: '3:13', folder: 'B', fullfolder: 'D:\\Music\\A\\B\\' })
    expect('album' in f).toBe(false)
  })
})
