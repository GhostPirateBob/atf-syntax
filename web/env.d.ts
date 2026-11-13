/// <reference types="vite/client" />

/** The search's fixed documents and their prebuilt MiniSearch index (see searchIndex() in vite.config.ts). */
declare module 'virtual:search-index' {
  /** The documents (SearchDoc[]), as JSON. */
  export const docs: string
  /** The serialised MiniSearch index without its terms, as JSON. */
  export const meta: string
  /** The index's terms, as JSON arrays of up to 1,500 entries. */
  export const termParts: string[]
}
