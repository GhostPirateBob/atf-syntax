import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

/**
 * What a share link carries: the format and which built-in sample track was selected. Never
 * anything from an imported playlist: those are the viewer's own file paths.
 */
export interface ShareState {
  doc: string
  sample?: number
}

export function encodeShare(state: ShareState): string {
  const params = new URLSearchParams()
  params.set('f', compressToEncodedURIComponent(state.doc))
  if (state.sample !== undefined && state.sample >= 0) params.set('s', String(state.sample))
  return '#' + params.toString()
}

export function decodeShare(hash: string): ShareState | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const f = params.get('f')
  if (!f) return undefined
  const doc = decompressFromEncodedURIComponent(f)
  if (doc === null || doc === '') return undefined
  const raw = params.get('s')
  const s = raw === null || raw === '' ? NaN : Number(raw)
  return { doc, sample: Number.isInteger(s) && s >= 0 ? s : undefined }
}
