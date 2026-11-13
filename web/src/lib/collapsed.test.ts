import { describe, expect, it } from 'vitest'
import { COLLAPSED_KEY, isExpanded, openOnly, readCollapsed, sectionFor, toggleSection, writeCollapsed } from './collapsed'

const memory = () => {
  const data = new Map<string, string>()
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}
const RECIPES = [
  { title: 'WACUP default', group: 'WACUP defaults' },
  { title: 'Numbered tracks', group: 'Custom recipes' },
]

describe('collapsed sidebar sections', () => {
  it('use the defaults with nothing stored, or with storage that is unreadable or malformed', () => {
    const defaults = ['recipes:Custom recipes', 'reference:functions']
    expect(readCollapsed(undefined).size).toBe(0)
    expect([...readCollapsed(undefined, defaults)]).toEqual(defaults)
    expect([...readCollapsed(memory(), defaults)]).toEqual(defaults)
    for (const raw of ['not json', '{"a":1}', '"x"']) {
      const s = memory()
      s.data.set(COLLAPSED_KEY, raw)
      expect([...readCollapsed(s, defaults)]).toEqual(defaults)
    }
    const throwing = { getItem: () => { throw new Error('blocked') } }
    expect([...readCollapsed(throwing, defaults)]).toEqual(defaults)
  })

  it('open as an accordion: one sibling open, keys outside the siblings untouched', () => {
    const siblings = ['recipes:A', 'recipes:B', 'recipes:C']
    const c = openOnly(new Set(['recipes:B', 'recipes:C']), 'recipes:B', siblings)
    expect([...c].sort()).toEqual(['recipes:A', 'recipes:C'])
    // recipes:saved isn't a sibling, so it stays as it was (open here).
    expect(openOnly(new Set(), 'recipes:C', siblings).has('recipes:saved')).toBe(false)
    expect(isExpanded(openOnly(new Set(), 'recipes:C', siblings), 'recipes:C')).toBe(true)
  })

  it('keep a stored choice over the defaults, an empty one (all expanded) included', () => {
    const s = memory()
    s.data.set(COLLAPSED_KEY, '[]')
    expect(readCollapsed(s, ['recipes:Custom recipes']).size).toBe(0)
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

  it("opens that section, closes its siblings and leaves the other tab's alone", () => {
    const c = new Set(['recipes:Custom recipes', 'reference:functions'])
    const key = sectionFor('recipe:Numbered tracks', RECIPES)!
    const after = openOnly(c, key, ['recipes:WACUP defaults', 'recipes:Custom recipes'])
    expect(isExpanded(after, key)).toBe(true)
    expect(isExpanded(after, 'recipes:WACUP defaults')).toBe(false)
    expect(isExpanded(after, 'reference:functions')).toBe(false)
    expect(c.has(key)).toBe(true) // the input isn't mutated
  })
})
