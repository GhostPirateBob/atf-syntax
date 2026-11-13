// Which sidebar sections are collapsed, kept in this browser. Pure apart from the storage passed in.
import type { StorageLike } from './saved'

export const COLLAPSED_KEY = 'atf-playground:collapsed'

/**
 * The collapsed section keys. Nothing stored yet (a first visit), or storage that is unreadable or
 * malformed: `defaults`. Once the visitor toggles a section their choice is stored, `[]` included.
 */
export function readCollapsed(store: Pick<StorageLike, 'getItem'> | undefined, defaults: Iterable<string> = []): Set<string> {
  try {
    const raw = store?.getItem(COLLAPSED_KEY)
    if (raw == null) return new Set(defaults)
    const list: unknown = JSON.parse(raw)
    return Array.isArray(list) ? new Set(list.filter((k): k is string => typeof k === 'string')) : new Set(defaults)
  } catch {
    return new Set(defaults)
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

/** A copy with `key` expanded and every other key in `siblings` collapsed: an accordion. */
export function openOnly(collapsed: ReadonlySet<string>, key: string, siblings: readonly string[]): Set<string> {
  const next = new Set(collapsed)
  for (const s of siblings) if (s !== key) next.add(s)
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
