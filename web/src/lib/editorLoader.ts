/**
 * The editor module (CodeMirror and everything it needs), fetched once. main.ts starts the fetch
 * before the first render, so it downloads while the page draws; components/AtfEditor.vue shows a
 * static copy of the format until it arrives. A failed fetch can be tried again.
 */
let loading: Promise<typeof import('./atfEditor')> | undefined
export function loadEditor(): Promise<typeof import('./atfEditor')> {
  loading ??= import('./atfEditor').catch((e: unknown) => {
    loading = undefined
    throw e
  })
  return loading
}
