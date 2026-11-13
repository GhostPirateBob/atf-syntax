/// <reference types="vite/client" />

/** The search's fixed documents and their prebuilt MiniSearch index (see searchIndex() in vite.config.ts). */
declare module 'virtual:search-index' {
  import type { AsPlainObject } from 'minisearch'
  import type { SearchDoc } from '@/lib/search'
  export const docs: SearchDoc[]
  export const index: AsPlainObject
}
