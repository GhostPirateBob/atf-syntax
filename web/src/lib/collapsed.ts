// Which sidebar sections are collapsed, kept in this browser. Pure apart from the storage passed in.
import type { StorageLike } from './saved'

export const COLLAPSED_KEY = 'atf-playground:collapsed'

/** The collapsed section keys. Missing, unreadable or malformed storage: none (all expanded). */
export function readCollapsed(store: Pick<StorageLike, 'getItem'> | undefined): Set<string> {
  try {
    const list: unknown = JSON.parse(store?.getItem(COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Stores the collapsed keys; a private window or full storage just means it won't persist. */
export function writeCollapsed(store: Pick<StorageLike, 'setItem'> | undefined, collapsed: ReadonlySet<string>): void {
  try {
    store?.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed].sort()))
  } catch {
    /* not persisted */
  }
}

/** A copy with `key` flipped. */
export function toggleSection(collapsed: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(collapsed)
  if (!next.delete(key)) next.add(key)
  return next
}

/** A copy with `key` expanded (the same set if it already was). */
export function expandSection(collapsed: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!collapsed.has(key)) return collapsed
  const next = new Set(collapsed)
  next.delete(key)
  return next
}

/** Whether a section shows its items. While the filter has text, every section does, so matches show. */
export const isExpanded = (collapsed: ReadonlySet<string>, key: string, filtering = false) => filtering || !collapsed.has(key)

/**
 * The section that holds a search target (`saved:<id>`, `recipe:<title>`, `field-<name>`,
 * `fn-<name>`), or undefined. Recipes are found by title in `recipes`, so their group decides.
 */
export function sectionFor(id: string, recipes: readonly { title: string; group: string }[]): string | undefined {
  if (id.startsWith('saved:')) return 'recipes:saved'
  if (id.startsWith('recipe:')) {
    const r = recipes.find((x) => x.title === id.slice('recipe:'.length))
    return r && `recipes:${r.group}`
  }
  if (id.startsWith('field-')) return 'reference:fields'
  if (id.startsWith('fn-')) return 'reference:functions'
  return undefined
}
