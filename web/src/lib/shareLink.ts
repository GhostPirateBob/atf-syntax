// Share links without lz-string up front: lib/share.ts (which imports lz-string) loads only when a
// link has to be read (the page opened on one) or written (Share link, or the address bar following
// an edited format).

/** Whether a URL hash is a share link (`#f=…`). */
export const isShareHash = (hash: string): boolean => new URLSearchParams(hash.replace(/^#/, '')).has('f')

let codec: Promise<typeof import('./share')> | undefined
/** lib/share.ts, loaded once. A failed fetch can be tried again. */
export function loadShare(): Promise<typeof import('./share')> {
  codec ??= import('./share').catch((e: unknown) => {
    codec = undefined
    throw e
  })
  return codec
}
