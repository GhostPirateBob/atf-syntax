/** Default face for rendered playlist titles (self-hosted: see src/fonts.css). */
export const TITLE_FAMILY =
  "'Roboto Condensed', 'Arial Narrow', 'Liberation Sans Narrow', 'Nimbus Sans Narrow', 'Helvetica Neue', Arial, sans-serif"
export const TITLE_WEIGHT = 350

/**
 * System font stacks from Modern Font Stacks, https://modernfontstacks.com
 * (github.com/system-fonts/modern-font-stacks), CC0 1.0. Copied verbatim from its README. The
 * font picker offers the fonts they name one by one, grouped by stack.
 */
const MODERN_FONT_STACKS: { name: string; stack: string }[] = [
  { name: 'System UI', stack: 'system-ui, sans-serif' },
  { name: 'Transitional', stack: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif" },
  { name: 'Old Style', stack: "'Iowan Old Style', 'Palatino Linotype', 'URW Palladio L', P052, serif" },
  { name: 'Humanist', stack: "Seravek, 'Gill Sans Nova', Ubuntu, Calibri, 'DejaVu Sans', source-sans-pro, sans-serif" },
  { name: 'Geometric Humanist', stack: "Avenir, Montserrat, Corbel, 'URW Gothic', source-sans-pro, sans-serif" },
  { name: 'Classical Humanist', stack: "Optima, Candara, 'Noto Sans', source-sans-pro, sans-serif" },
  { name: 'Neo-Grotesque', stack: "Inter, Roboto, 'Helvetica Neue', 'Arial Nova', 'Nimbus Sans', Arial, sans-serif" },
  { name: 'Monospace Slab Serif', stack: "'Nimbus Mono PS', 'Courier New', monospace" },
  { name: 'Monospace Code', stack: "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace" },
  { name: 'Industrial', stack: "Bahnschrift, 'DIN Alternate', 'Franklin Gothic Medium', 'Nimbus Sans Narrow', sans-serif-condensed, sans-serif" },
  {
    name: 'Rounded Sans',
    stack: "ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, Manjari, 'Arial Rounded MT', 'Arial Rounded MT Bold', Calibri, source-sans-pro, sans-serif",
  },
  { name: 'Slab Serif', stack: "Rockwell, 'Rockwell Nova', 'Roboto Slab', 'DejaVu Serif', 'Sitka Small', serif" },
  { name: 'Antique', stack: "Superclarendon, 'Bookman Old Style', 'URW Bookman', 'URW Bookman L', 'Georgia Pro', Georgia, serif" },
  { name: 'Didone', stack: "Didot, 'Bodoni MT', 'Noto Serif Display', 'URW Palladio L', P052, Sylfaen, serif" },
  { name: 'Handwritten', stack: "'Segoe Print', 'Bradley Hand', Chilanka, TSCu_Comic, casual, cursive" },
]

/** CSS generic families and system keywords: not font names, so never offered on their own. */
const KEYWORDS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'math', 'emoji', 'fangsong', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'])

/** Arial (classic Winamp) sits at the top of the picker, so the groups leave it out. */
export const ARIAL = 'Arial'

export interface FontGroup {
  /** e.g. "Transitional: Charter, Bitstream Charter, Sitka Text, Cambria" */
  label: string
  /** The stack's generic family: the only fallback a font from this group gets. */
  generic: string
  fonts: string[]
}

/** Each font named in the stacks once (first stack wins), grouped by stack. Stacks with no font names are left out. */
export const FONT_GROUPS: FontGroup[] = (() => {
  const seen = new Set([ARIAL])
  const groups: FontGroup[] = []
  for (const { name, stack } of MODERN_FONT_STACKS) {
    const names = stack.split(',').map((s) => s.trim().replace(/^'(.*)'$/, '$1'))
    const generic = names[names.length - 1]!
    const fonts = names.filter((f) => !KEYWORDS.has(f) && !seen.has(f))
    fonts.forEach((f) => seen.add(f))
    if (fonts.length) groups.push({ label: `${name}: ${fonts.join(', ')}`, generic, fonts })
  }
  return groups
})()

const genericFor = (name: string) => FONT_GROUPS.find((g) => g.fonts.includes(name))?.generic ?? 'sans-serif'
export const quoted = (name: string) => `"${name.trim().replace(/["\\]/g, '')}"`

/** One font with its generic fallback, e.g. `"Charter", serif`. '' = the default title face. */
export function singleFont(name: string): string {
  return name.trim() ? `${quoted(name)}, ${genericFor(name.trim())}` : TITLE_FAMILY
}

/**
 * The title font: a typed local font name first, falling back to the picked font (or the default
 * Roboto Condensed stack). Weight 350 suits only the default face; anything else is drawn at 400.
 */
export function titleFont(localName: string, picked: string): { family: string; weight: number } {
  const local = localName.trim().replace(/["\\]/g, '')
  return {
    family: local ? `"${local}", ${singleFont(picked)}` : singleFont(picked),
    weight: !local && !picked.trim() ? TITLE_WEIGHT : 400,
  }
}
