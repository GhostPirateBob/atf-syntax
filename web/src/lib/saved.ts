import { ref } from 'vue'
import { toFormat } from './document'
import type { Recipe } from './recipes'

/**
 * Formats saved in this browser, and the autosave of the last format. Only formats are stored,
 * never playlist or file data. Every storage access is wrapped, so the page works with storage
 * blocked (a private window, or site data turned off).
 */
export interface SavedFormat {
  id: string
  name: string
  doc: string
  savedAt: number
}

/** The part of the Web Storage API used here, so tests can pass a fake. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const SAVED_KEY = 'atf-playground:saved'
export const LAST_KEY = 'atf-playground:last'

/** localStorage, or undefined where even touching it throws. */
export function browserStorage(): StorageLike | undefined {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage
  } catch {
    return undefined
  }
}

function read(store: StorageLike | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}
function write(store: StorageLike | undefined, key: string, value: string): boolean {
  try {
    if (!store) return false
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
}

const isSaved = (x: unknown): x is SavedFormat => {
  const r = x as Record<string, unknown> | null
  return !!r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.doc === 'string' && typeof r.savedAt === 'number'
}

/** The saved list; anything malformed is dropped. */
export function loadSaved(store: StorageLike | undefined): SavedFormat[] {
  try {
    const raw: unknown = JSON.parse(read(store, SAVED_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter(isSaved) : []
  } catch {
    return []
  }
}

export function writeSaved(store: StorageLike | undefined, list: SavedFormat[]): boolean {
  return write(store, SAVED_KEY, JSON.stringify(list))
}

const newSavedId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Adds a format at the top of the list. */
export function addSaved(list: SavedFormat[], name: string, doc: string, now = Date.now(), id = newSavedId()): SavedFormat[] {
  return [{ id, name: name.trim() || 'Untitled', doc, savedAt: now }, ...list]
}
export function renameSaved(list: SavedFormat[], id: string, name: string): SavedFormat[] {
  const n = name.trim()
  return n ? list.map((s) => (s.id === id ? { ...s, name: n } : s)) : list
}
export function deleteSaved(list: SavedFormat[], id: string): SavedFormat[] {
  return list.filter((s) => s.id !== id)
}
/** Puts a deleted entry back where it was (for Undo). */
export function undoDelete(list: SavedFormat[], entry: SavedFormat, index: number): SavedFormat[] {
  if (list.some((s) => s.id === entry.id)) return list
  const out = [...list]
  out.splice(Math.min(Math.max(index, 0), out.length), 0, entry)
  return out
}

/** A name to offer when saving: the recipe it matches, or the start of the format. */
export function defaultSaveName(doc: string, recipes: Recipe[]): string {
  const format = toFormat(doc).format
  const recipe = recipes.find((r) => r.format === format)
  if (recipe) return recipe.title
  const flat = format.trim()
  return flat.length > 30 ? `${flat.slice(0, 30)}…` : flat
}

// ---- autosave -------------------------------------------------------------------------------
export function readLast(store: StorageLike | undefined): string | undefined {
  const v = read(store, LAST_KEY)
  return v === null ? undefined : v
}
export function writeLast(store: StorageLike | undefined, doc: string): boolean {
  return write(store, LAST_KEY, doc)
}

/**
 * The format to open with. A share link wins (the autosave is left alone); otherwise an autosave
 * that differs from the default is restored; first visits get the default.
 */
export function initialDoc(shared: string | undefined, last: string | undefined, defaultDoc: string): { doc: string; restored: boolean } {
  if (shared !== undefined) return { doc: shared, restored: false }
  if (last !== undefined && last.trim() !== '' && last !== defaultDoc) return { doc: last, restored: true }
  return { doc: defaultDoc, restored: false }
}

// ---- the page's shared copy -------------------------------------------------------------------
const store = browserStorage()
/** The saved formats, shared by the editor box, the sidebar and the search. */
export const savedFormats = ref<SavedFormat[]>(loadSaved(store))

/** Applies a change to the saved list and stores it. False if the browser wouldn't store it. */
export function updateSaved(change: (list: SavedFormat[]) => SavedFormat[]): boolean {
  savedFormats.value = change(savedFormats.value)
  return writeSaved(store, savedFormats.value)
}
