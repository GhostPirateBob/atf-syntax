import { formatDocument, parse, splitBlocks } from '@/core'

/** Narrowest wrap the format button uses, however small the editor is. */
export const MIN_LINE_WIDTH = 40

/**
 * Re-wraps the editor's document with the extension's lossless formatter. `blocked` is true when
 * nothing changed because a block has a syntax error (the formatter leaves those as written).
 */
export function formatDoc(doc: string, lineWidth: number): { text: string; changed: boolean; blocked: boolean } {
  const lines = doc.split('\n')
  const text = formatDocument(lines, { lineWidth: Math.max(MIN_LINE_WIDTH, Math.floor(lineWidth)) }).join('\n')
  const changed = text !== doc
  const blocked =
    !changed &&
    splitBlocks(lines.map((l) => l.replace(/\r$/, ''))).some((b) => {
      const r = parse(b.text)
      return !!(r.error || r.tooDeep)
    })
  return { text, changed, blocked }
}
