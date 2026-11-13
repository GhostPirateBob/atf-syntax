import { quoted } from './fontStacks'

let ctx: CanvasRenderingContext2D | null | undefined

/**
 * Pixel width of `text` in a CSS font, via canvas. Like WACUP's GDI DrawText (and the playlist
 * rows' CSS), with no kerning and no letter spacing. Still approximate: GDI rounds each letter to
 * whole pixels.
 */
export function measureText(text: string, cssFont: string): number {
  if (ctx === undefined) {
    ctx = document.createElement('canvas').getContext('2d')
    if (ctx && 'fontKerning' in ctx) ctx.fontKerning = 'none'
    if (ctx && 'letterSpacing' in ctx) ctx.letterSpacing = '0px'
  }
  if (!ctx) return 0
  ctx.font = cssFont
  return ctx.measureText(text).width
}

const installed = new Map<string, boolean>()
/**
 * Whether a font is installed, by the classic canvas test: text in `"Font", monospace` and
 * `"Font", sans-serif` measures the same as the bare fallbacks only if the font is missing.
 * (document.fonts.check() can't tell: it answers true for any system font name.)
 */
export function fontInstalled(name: string): boolean {
  let known = installed.get(name)
  if (known === undefined) {
    const test = 'mmmmmmmmmmlli1WQ@#&wy'
    const differs = (generic: string) => measureText(test, `72px ${quoted(name)}, ${generic}`) !== measureText(test, `72px ${generic}`)
    known = differs('monospace') || differs('sans-serif')
    installed.set(name, known)
  }
  return known
}
