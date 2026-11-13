import { describe, expect, it } from 'vitest'
import { NUL_MESSAGE, NUL_RULE, nulFindings, nulOffsets } from './nulChar'
import { tagsFromMediaInfo } from './mediainfo'

describe('NUL in the format', () => {
  it('finds every NUL offset', () => {
    expect(nulOffsets('')).toEqual([])
    expect(nulOffsets('%artist%')).toEqual([])
    expect(nulOffsets('\0')).toEqual([0])
    expect(nulOffsets('a\0b\0\0c')).toEqual([1, 3, 4])
  })
  it('warns once, at the first NUL, since WACUP stops reading there', () => {
    expect(nulFindings('%title%')).toEqual([])
    expect(nulFindings('%artist%\0 - %title%\0')).toEqual([{ start: 8, end: 9, severity: 'warning', message: NUL_MESSAGE, rule: NUL_RULE }])
  })
})

describe('NUL in tag values read from files', () => {
  const tags = (title: string) => tagsFromMediaInfo({ media: { track: [{ '@type': 'General', Title: title, Performer: title }] } }, 'x.mp3')
  it('joins multiple values with " / ", like MediaInfo', () => {
    expect(tags('A\u0000B').title).toBe('A / B')
    expect(tags('A\u0000B').artist).toBe('A / B')
  })
  it('collapses repeats and drops a trailing NUL', () => {
    expect(tags('A\u0000').title).toBe('A')
    expect(tags('A\u0000\u0000B').title).toBe('A / B')
    expect(tags('\u0000A \u0000 B\u0000').title).toBe('A / B')
  })
  it('leaves a value that is only NULs out', () => {
    expect(tags('\u0000\u0000').title).toBeUndefined()
  })
})
