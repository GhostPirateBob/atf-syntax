import { describe, expect, it } from 'vitest'
import { docRange, toFormat } from './document'
import { tokenize } from './tokens'
import { tagsFromMediaInfo } from './mediainfo'
import { SAMPLE_TRACKS } from './tracks'
import { applyDisplay, DEFAULT_DISPLAY } from './display'
import { formatLength, parseM3u } from './m3u'
import { decodeShare, encodeShare } from './share'
import { fieldsFor, tracksFromFiles, tracksFromPlaylist } from './tracks'
import { isAudioName, isPlaylistName, matchPlaylistFiles } from './audio'

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

describe('mediainfo', () => {
  it('maps mediainfo JSON to ATF tags', () => {
    const tags = tagsFromMediaInfo(
      {
        media: {
          track: [
            { '@type': 'General', Title: 'Juicy', Performer: 'The Notorious B.I.G.', Track_Position: '1457', Recorded_Date: '1994-09-13', Duration: '302.667', OverallBitRate: '216157' },
            { '@type': 'Audio', BitRate: '216157', BitRate_Mode: 'VBR', SamplingRate: '44100' },
          ],
        },
      },
      'D:\\Music\\Juicy.mp3',
    )
    expect(tags).toEqual({
      filename: 'D:\\Music\\Juicy.mp3', title: 'Juicy', artist: 'The Notorious B.I.G.', tracknumber: '1457', year: '1994-09-13',
      length_seconds: '303', bitrate: '216', samplerate: '44100', vbr: '1',
    })
  })
  it('builds the real-file samples from the shipped JSON', () => {
    expect(SAMPLE_TRACKS[0].tags).toMatchObject({ artist: 'Alfie Templeman', tracknumber: '0172', publisher: 'Chess Club Records', bitrate: '320' })
    expect(SAMPLE_TRACKS.at(-1)?.tags.artist).toBeUndefined()
    expect(SAMPLE_TRACKS.every(Boolean)).toBe(true)
  })
})

describe('audio files', () => {
  it('knows audio and playlist files by extension', () => {
    expect(['a.MP3', 'b.flac', 'c.Opus', 'd.aif', 'e.dsf'].every(isAudioName)).toBe(true)
    expect(isAudioName('cover.jpg')).toBe(false)
    expect(isAudioName('mp3')).toBe(false)
    expect(isPlaylistName('Mix.M3U8')).toBe(true)
  })
  it('match playlist entries by file name, ignoring case, in playlist order', () => {
    const entries = ['D:\\Music\\A\\01 One.mp3', 'D:\\Music\\A\\02 Two.FLAC', 'http://stream.example/live', 'D:\\Music\\A\\03 Three.mp3']
    expect(matchPlaylistFiles(entries, ['02 two.flac', '01 One.mp3', 'cover.mp3'])).toEqual([1, 0, -1, -1])
  })
  it('break ties between same-named files by the relative path tail', () => {
    const files = ['Album A/01 Intro.mp3', 'Album B/01 Intro.mp3', 'Album B/Disc 2/01 Intro.mp3']
    expect(matchPlaylistFiles(['D:\\Music\\Album B\\01 Intro.mp3', 'E:/x/album b/disc 2/01 intro.mp3', 'C:\\Other\\01 Intro.mp3'], files)).toEqual([1, 2, 0])
  })
  it('merge file tags into the playlist, keeping its order and full paths', () => {
    const entries = parseM3u('#EXTINF:200,Cached\nD:\\Music\\A\\01 One.mp3\n#EXTINF:99,Other\nD:\\Music\\A\\02 Two.mp3')
    const files = [{ path: 'A/01 One.mp3', tags: { filename: 'A/01 One.mp3', artist: 'X', title: 'One', length_seconds: '201' } }]
    const match = matchPlaylistFiles(entries.map((e) => e.filename), files.map((f) => f.path))
    const tracks = tracksFromPlaylist(entries, match.map((i) => files[i]?.tags))
    expect(tracks.map((t) => t.tags)).toEqual([
      { filename: 'D:\\Music\\A\\01 One.mp3', artist: 'X', title: 'One', length_seconds: '201' },
      { filename: 'D:\\Music\\A\\02 Two.mp3', length_seconds: '99' },
    ])
    expect(tracks[0]!.cachedTitle).toBe('Cached')
    expect(fieldsFor(tracks[0]!)).toMatchObject({ folder: 'A', length: '3:21' })
  })
  it('turn files on their own into tracks', () => {
    const [t] = tracksFromFiles([{ filename: 'Album/01 One.mp3', title: 'One' }])
    expect(t).toMatchObject({ source: 'files', tags: { title: 'One' } })
    expect(fieldsFor(t!)).toMatchObject({ folder: 'Album', fullfolder: 'Album/' })
  })
})
