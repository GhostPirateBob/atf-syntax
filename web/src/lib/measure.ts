let ctx: CanvasRenderingContext2D | null | undefined

/** Pixel width of `text` in a CSS font, via canvas. Approximate: browsers render text differently to WACUP's GDI. */
export function measureText(text: string, cssFont: string): number {
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return 0
  ctx.font = cssFont
  return ctx.measureText(text).width
}

/** Default face for rendered playlist titles (loaded from Google Fonts in index.html). */
export const TITLE_FAMILY =
  "'Roboto Condensed', 'Arial Narrow', 'Liberation Sans Narrow', 'Nimbus Sans Narrow', 'Helvetica Neue', Arial, sans-serif"
export const TITLE_WEIGHT = 350

/** CSS font-family list for a user-typed local font name, falling back to the title font. */
export function fontStack(name: string, fallback: string = TITLE_FAMILY): string {
  const clean = name.trim().replace(/["\\]/g, '')
  return clean ? `"${clean}", ${fallback}` : fallback
}

/** Weight to use: the title weight for the default face, normal for a user's own font. */
export function fontWeight(name: string): number {
  return name.trim() ? 400 : TITLE_WEIGHT
}
