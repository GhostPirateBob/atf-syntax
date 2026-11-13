/// <reference types="vite/client" />

/** True only in a vapor-mode build (vite.config.ts, vapor.config.ts). */
declare const __VAPOR__: boolean

/** The search's fixed documents and their prebuilt MiniSearch index (see searchIndex() in vite.config.ts). */
declare module 'virtual:search-index' {
  /** The documents (SearchDoc[]), as JSON. */
  export const docs: string
  /** The serialised MiniSearch index without its terms, as JSON. */
  export const meta: string
  /** The index's terms, as JSON arrays of up to 1,500 entries. */
  export const termParts: string[]
}
