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
import { durationOf, type Track } from './tracks'
import { RECIPES } from './recipes'
import { fitText } from './fit'
import { DEFAULT_VIEW, parseView } from './view'
import { FONT_GROUPS, TITLE_FAMILY, titleFont } from './fontStacks'
import { evaluate } from '@core/evaluate'

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
    // The first sample isn't the default one, so index 0 must survive the round trip too.
    expect(decodeShare(encodeShare({ doc, sample: 0 }))).toEqual({ doc, sample: 0 })
    expect(decodeShare(encodeShare({ doc }))).toEqual({ doc, sample: undefined })
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
  it('adds %playlist_position% and %playlist_length% from the track list, not the tags', () => {
    const t = { id: 'x', source: 'custom' as const, tags: { artist: 'A', title: 'T', length_seconds: '260', filename: 'D:\\m\\t.mp3' } }
    expect(fieldsFor(t, { position: 3, length: 12 })).toMatchObject({ playlist_position: '3', playlist_length: '12' })
    expect('playlist_position' in fieldsFor(t)).toBe(false)
    const wacup = RECIPES.find((r) => r.title === "WACUP's default song ticker")!.format
    expect(evaluate(wacup, fieldsFor(t, { position: 3, length: 12 })).text).toBe('3. A - T (4:20)')
    const spc = { ...t, tags: { ...t.tags, album: 'Chrono Trigger', filename: 'D:\\m\\c.spc' } }
    expect(evaluate(wacup, fieldsFor(spc, { position: 1, length: 1 })).text).toBe('1. Chrono Trigger - T (4:20)')
  })
  it('shows durations like a playlist, blank when unknown', () => {
    const t = (length_seconds?: string): Track => ({ id: 'x', source: 'custom', tags: length_seconds === undefined ? {} : { length_seconds } })
    expect([t('260'), t('3725'), t(), t('junk')].map((x) => durationOf(x))).toEqual(['4:20', '1:02:05', '', ''])
  })
})

describe('fitText', () => {
  // One unit per character, so widths are easy to reason about.
  const len = (s: string) => Array.from(s).length
  it('cuts WACUP-style, with three ASCII dots, only when the text is too wide', () => {
    expect(fitText('The Recipe', 10, len)).toBe('The Recipe')
    expect(fitText('The Recipe (Black Hippy Remix)', 15, len)).toBe('The Recipe (...')
    expect(fitText('abc', 2, len)).toBe('...')
  })
  it('never splits a surrogate pair', () => {
    expect(fitText('ab😀cdef', 6, len)).toBe('ab😀...')
  })
})

describe('view settings', () => {
  it('fill in keys that older saved settings lack, and drop bad values', () => {
    const old = JSON.stringify({ trimLeading: false, font: 'Tahoma', fontSize: 14, width: 300, numbers: true })
    expect(parseView(old)).toEqual({ ...DEFAULT_VIEW, trimLeading: false, font: 'Tahoma', fontSize: 14, width: 300, numbers: true })
    expect(parseView(JSON.stringify({ dialect: 'foobar2000', fontFamily: 7, width: '300' }))).toEqual(DEFAULT_VIEW)
    expect(parseView('{oops')).toEqual(DEFAULT_VIEW)
    expect(parseView(null)).toEqual(DEFAULT_VIEW)
  })
  it('use one picked font with only its stack\'s generic fallback, a typed font first', () => {
    expect(titleFont('', '')).toEqual({ family: TITLE_FAMILY, weight: 350 })
    expect(titleFont('', 'Charter')).toEqual({ family: '"Charter", serif', weight: 400 })
    expect(titleFont('', 'Cascadia Code')).toEqual({ family: '"Cascadia Code", monospace', weight: 400 })
    expect(titleFont('', 'Arial')).toEqual({ family: '"Arial", sans-serif', weight: 400 })
    expect(titleFont(' Tahoma ', 'Charter')).toEqual({ family: '"Tahoma", "Charter", serif', weight: 400 })
    expect(titleFont('Tahoma', '')).toEqual({ family: `"Tahoma", ${TITLE_FAMILY}`, weight: 400 })
  })
  it('list each font once, grouped by stack, without CSS keywords', () => {
    const all = FONT_GROUPS.flatMap((g) => g.fonts)
    expect(new Set(all).size).toBe(all.length)
    expect(all).not.toContain('serif')
    expect(all).not.toContain('ui-monospace')
    expect(all).not.toContain('Arial')
    expect(FONT_GROUPS[0]!.label).toBe('Transitional: Charter, Bitstream Charter, Sitka Text, Cambria')
    expect(FONT_GROUPS.find((g) => g.label.startsWith('Didone'))!.fonts).not.toContain('P052')
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
      filename: 'D:\\Music\\Juicy.mp3', title: 'Juicy', artist: 'The Notorious B.I.G.', tracknumber: '1457', year: '1994',
      length_seconds: '303', bitrate: '216', samplerate: '44100', vbr: '1',
    })
  })
  it("takes %year% from the date's four-digit year, falling back to the original release date", () => {
    const year = (general: Record<string, string>) => tagsFromMediaInfo({ media: { track: [{ '@type': 'General', ...general }] } }, 'x.mp3').year
    expect(year({ Original_Released_Date: '2013-07-08' })).toBe('2013')
    expect(year({ Recorded_Date: '1977', Original_Released_Date: '2011-01-01' })).toBe('1977')
    expect(year({ Recorded_Date: 'Summer of 69' })).toBe('Summer of 69')
    expect(year({})).toBeUndefined()
  })
  it('builds the real-file samples from the shipped JSON', () => {
    expect(SAMPLE_TRACKS[0].tags).toMatchObject({ artist: 'Alfie Templeman', tracknumber: '0172', publisher: 'Chess Club Records', bitrate: '320' })
    expect(SAMPLE_TRACKS.slice(0, 3).map((t) => t.tags.year)).toEqual(['2020', '2013', '1994'])
    expect(SAMPLE_TRACKS.at(-1)?.tags.title).toBe('Dogs')
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
