import { describe, expect, it } from 'vitest'
import { COLLAPSED_KEY, expandSection, isExpanded, readCollapsed, sectionFor, toggleSection, writeCollapsed } from './collapsed'

const memory = () => {
  const data = new Map<string, string>()
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}
const RECIPES = [
  { title: 'WACUP default', group: 'WACUP defaults' },
  { title: 'Numbered tracks', group: 'Custom recipes' },
]

describe('collapsed sidebar sections', () => {
  it('are all expanded with nothing stored, or with storage that is unreadable or malformed', () => {
    expect(readCollapsed(undefined).size).toBe(0)
    expect(readCollapsed(memory()).size).toBe(0)
    for (const raw of ['not json', '{"a":1}', '"x"']) {
      const s = memory()
      s.data.set(COLLAPSED_KEY, raw)
      expect(readCollapsed(s).size).toBe(0)
    }
    const throwing = { getItem: () => { throw new Error('blocked') } }
    expect(readCollapsed(throwing).size).toBe(0)
  })

  it('persist under atf-playground:collapsed and read back', () => {
    const s = memory()
    let c = toggleSection(new Set(), 'recipes:Custom recipes')
    c = toggleSection(c, 'reference:functions')
    writeCollapsed(s, c)
    expect(JSON.parse(s.data.get('atf-playground:collapsed')!)).toEqual(['recipes:Custom recipes', 'reference:functions'])
    expect([...readCollapsed(s)].sort()).toEqual(['recipes:Custom recipes', 'reference:functions'])
    // Toggling again expands it; non-string entries in storage are ignored.
    writeCollapsed(s, toggleSection(readCollapsed(s), 'reference:functions'))
    expect([...readCollapsed(s)]).toEqual(['recipes:Custom recipes'])
    s.data.set(COLLAPSED_KEY, '["a", 1, null]')
    expect([...readCollapsed(s)]).toEqual(['a'])
  })

  it("don't throw when storage refuses the write", () => {
    expect(() => writeCollapsed({ setItem: () => { throw new Error('quota') } }, new Set(['x']))).not.toThrow()
  })

  it('all show while the filter has text, without changing what is stored', () => {
    const c = new Set(['reference:fields'])
    expect(isExpanded(c, 'reference:fields')).toBe(false)
    expect(isExpanded(c, 'reference:fields', true)).toBe(true)
    expect(isExpanded(c, 'reference:functions')).toBe(true)
    expect([...c]).toEqual(['reference:fields'])
  })
})

describe('search reveal in a collapsed section', () => {
  it('finds the section that holds each kind of target', () => {
    expect(sectionFor('recipe:Numbered tracks', RECIPES)).toBe('recipes:Custom recipes')
    expect(sectionFor('saved:abc', RECIPES)).toBe('recipes:saved')
    expect(sectionFor('field-artist', RECIPES)).toBe('reference:fields')
    expect(sectionFor('fn-if2', RECIPES)).toBe('reference:functions')
    expect(sectionFor('recipe:Gone', RECIPES)).toBeUndefined()
    expect(sectionFor('other', RECIPES)).toBeUndefined()
  })

  it('expands that section and leaves the others collapsed', () => {
    const c = new Set(['recipes:Custom recipes', 'reference:functions'])
    const key = sectionFor('recipe:Numbered tracks', RECIPES)!
    const after = expandSection(c, key)
    expect(isExpanded(after, key)).toBe(true)
    expect(isExpanded(after, 'reference:functions')).toBe(false)
    expect(expandSection(after, key)).toBe(after) // already expanded: unchanged
    expect(c.has(key)).toBe(true) // the input isn't mutated
  })
})
