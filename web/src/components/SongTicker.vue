<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Row } from './TrackList.vue'
import { clampFontSize, type ViewSettings } from '@/lib/view'
import { NARROW, useMedia } from '@/lib/media'
import { measureText } from '@/lib/measure'
import { fontsLoaded, useWidth } from '@/lib/rowFit'
import { theme } from '@/lib/theme'
import { ROW_STATE_TEXT } from '@/lib/playlistWindow'
import { TICKER_SEPARATOR, TICKER_STEP_MS, glyphCell, nextStep, stripOffset, tickerChars, tickerStrip, totalAdvance, type TickerItem } from '@/lib/ticker'
import { tickerFont } from '@/lib/tickerFont'

/**
 * The preview while a song ticker recipe is loaded: the selected track's title on one line,
 * scrolled left one character every TICKER_STEP_MS like Winamp's ticker, then `  ***  ` and round
 * again. The strip of glyphs moves by a stepped transform (no transition), so each step is a
 * compositor-only change. Like a stock ticker it always runs, a short title too (the strip repeats
 * to fill the box, so it wraps in from the right seamlessly). It stands still while hovered (WCAG
 * 2.2.2's pause) and while the page is hidden. Not while focused: a click on it, or a ticker recipe picked just
 * before, would leave focus there and stop it for good. With less motion it still steps (it only
 * ever jumps a glyph at a time, nothing glides), since a ticker that never moves isn't a preview. Drawn in the user's skin
 * ticker font (a bitmap sheet, on a canvas tinted with the theme's text colour) if they set one in
 * Settings, otherwise in the bundled VT323 pixel font.
 */
const props = defineProps<{
  row?: Row
  selected: number
  count: number
  view: ViewSettings
  /** Shown in place of the ticker, for states that aren't about one track. */
  message?: { text: string; tone: 'warn' | 'muted' }
}>()
const emit = defineEmits<{ select: [index: number] }>()

const narrow = useMedia(NARROW)
// The same zoom and width as the playlist preview it replaces.
const zoom = computed(() => (narrow.value ? 1 : 1.5))
const CHROME = 2 * 10 + 2 * 1 + 8
const size = computed(() => clampFontSize(props.view.fontSize) * zoom.value)
const boxStyle = computed(() => ({ width: props.view.width ? `${props.view.width * zoom.value + CHROME}px` : '100%' }))

const text = computed(() => {
  const row = props.row
  if (!row) return ''
  return ROW_STATE_TEXT[row.state] ?? row.text
})
const tone = computed(() => (!props.row ? '' : ROW_STATE_TEXT[props.row.state] ? 'warn' : props.row.state === 'error' ? 'error' : ''))

// ---- fonts -----------------------------------------------------------------------------------------
/** VT323 (OFL), loaded only when the ticker first shows. Monospaced, so one step is one cell. */
const DEFAULT_FAMILY = "'VT323', ui-monospace, monospace"
const defaultPx = computed(() => Math.round(size.value * 1.3))
const defaultFont = computed(() => `400 ${defaultPx.value}px ${DEFAULT_FAMILY}`)
const defaultReady = ref(0)
onMounted(async () => {
  try {
    await import('@fontsource/vt323/index.css')
    await document.fonts.load(`20px VT323`)
  } catch {
    /* offline or blocked: the monospace fallback measures just as well */
  }
  defaultReady.value++
})

/** The skin's sheet, once decoded; until then (or if it won't decode) the default font shows. */
const sheet = shallowRef<HTMLImageElement>()
watch(
  () => tickerFont.value?.dataUrl,
  (url) => {
    sheet.value = undefined
    if (!url) return
    const img = new Image()
    img.onload = () => tickerFont.value?.dataUrl === url && (sheet.value = img)
    img.src = url
  },
  { immediate: true },
)
const skin = computed(() => (sheet.value ? tickerFont.value : null))
/** Whole-pixel zoom for the bitmap glyphs, as close to the playlist's text size as it gets. */
const skinScale = computed(() => (skin.value ? Math.max(1, Math.round(size.value / skin.value.charHeight)) : 1))

function advanceOf(ch: string): number {
  const f = skin.value
  return f ? (f.charWidth + f.hspacing) * skinScale.value : measureText(ch, defaultFont.value)
}

// ---- the strip and its steps -----------------------------------------------------------------------
const items = (s: string): TickerItem[] => {
  void fontsLoaded.value
  void defaultReady.value
  return tickerChars(s).map((ch) => ({ ch, advance: advanceOf(ch) }))
}
const textItems = computed(() => items(text.value))
const unit = computed(() => [...textItems.value, ...items(TICKER_SEPARATOR)])

const clipEl = ref<HTMLElement>()
const boxWidth = useWidth(clipEl)
const scrolls = computed(() => !props.message && boxWidth.value > 0 && textItems.value.length > 0)
const strip = computed(() => (scrolls.value ? tickerStrip(unit.value, boxWidth.value) : textItems.value))

const step = ref(0)
const offset = computed(() => (scrolls.value && unit.value.length ? stripOffset(unit.value, step.value % unit.value.length) : 0))
const stripStyle = computed(() => ({ transform: `translate3d(${-offset.value}px, 0, 0)` }))
// A new title starts from its beginning. (Not when the box is resized: that just carries on.)
watch(text, () => (step.value = 0))

const hovering = ref(false)
const hidden = ref(document.visibilityState === 'hidden')
const onVisibility = () => (hidden.value = document.visibilityState === 'hidden')
document.addEventListener('visibilitychange', onVisibility)
const running = computed(() => scrolls.value && !hovering.value && !hidden.value)
let timer: ReturnType<typeof setInterval> | undefined
watch(
  running,
  (on) => {
    clearInterval(timer)
    if (on) timer = setInterval(() => (step.value = nextStep(step.value, unit.value.length)), TICKER_STEP_MS)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibility)
})

// ---- bitmap font drawing ------------------------------------------------------------------------
const canvasEl = ref<HTMLCanvasElement>()
let tinted: { key: string; canvas: HTMLCanvasElement } | undefined
/** The sheet with its white glyphs recoloured (keeping their alpha), cached per colour. */
function tintedSheet(img: HTMLImageElement, colour: string): HTMLCanvasElement {
  const key = `${img.src.length}:${img.src.slice(-32)}|${colour}`
  if (tinted?.key === key) return tinted.canvas
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, c.width, c.height)
  tinted = { key, canvas: c }
  return c
}
function draw() {
  const c = canvasEl.value
  const f = skin.value
  const img = sheet.value
  if (!c || !f || !img || !clipEl.value) return
  const s = skinScale.value
  const dpr = window.devicePixelRatio || 1
  const list = strip.value
  // The last glyph is a whole cell wide, wider than its advance when hspacing is negative.
  const cssW = Math.max(1, Math.ceil(totalAdvance(list) + Math.max(0, -f.hspacing) * s))
  const cssH = f.charHeight * s
  c.width = Math.round(cssW * dpr)
  c.height = Math.round(cssH * dpr)
  c.style.width = `${cssW}px`
  c.style.height = `${cssH}px`
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  const src = tintedSheet(img, getComputedStyle(clipEl.value).color)
  const w = Math.round(f.charWidth * s * dpr)
  const h = Math.round(cssH * dpr)
  let x = 0
  for (const it of list) {
    const cell = glyphCell(it.ch)
    const sx = cell ? cell.col * f.charWidth : -1
    const sy = cell ? cell.row * f.charHeight : -1
    if (cell && sx + f.charWidth <= img.naturalWidth && sy + f.charHeight <= img.naturalHeight) {
      ctx.drawImage(src, sx, sy, f.charWidth, f.charHeight, Math.round(x * dpr), 0, w, h)
    }
    x += it.advance
  }
}
watch([strip, skin, skinScale, tone, theme, canvasEl], draw, { flush: 'post' })

// ---- keys --------------------------------------------------------------------------------------
function onKey(e: KeyboardEvent) {
  const n = props.count
  const by = { ArrowUp: -1, ArrowDown: 1 }[e.key]
  if (by && n > 1) emit('select', (props.selected + by + n) % n)
  else if (e.key === 'Home' && n) emit('select', 0)
  else if (e.key === 'End' && n) emit('select', n - 1)
  else return
  e.preventDefault()
}
</script>

<template>
  <div class="tk" :style="boxStyle" @pointerenter="hovering = true" @pointerleave="hovering = false">
    <p v-if="message" class="tk-message" :class="message.tone">{{ message.text }}</p>
    <div
      v-else
      ref="clipEl"
      class="tk-clip"
      :class="[tone, { skin: !!skin }]"
      :style="skin ? { height: `${skin.charHeight * skinScale}px` } : { fontSize: `${defaultPx}px` }"
      role="listbox"
      tabindex="0"
      aria-label="Song ticker preview. Up and Down change the track."
      aria-activedescendant="tk-current"
      :title="text || undefined"
      @keydown="onKey"
    >
      <div id="tk-current" class="tk-sr" role="option" aria-selected="true">{{ text || 'No title' }}</div>
      <canvas v-if="skin" ref="canvasEl" class="tk-strip" aria-hidden="true" :style="stripStyle" />
      <span v-else class="tk-strip tk-text playlist-text" aria-hidden="true" :style="stripStyle"
        ><span v-for="(it, i) in strip" :key="i" class="g" :style="{ width: `${it.advance}px` }">{{ it.ch }}</span></span
      >
    </div>
  </div>
</template>

<style scoped>
/* The playlist preview's frame, one line high. */
.tk {
  position: relative;
  max-width: 100%;
  margin: 0 auto;
  background: var(--playlist-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  box-shadow: 0 6px 22px var(--shadow);
  padding: 6px 10px;
  text-align: left;
}
.tk-clip {
  position: relative;
  overflow: hidden;
  color: var(--bright);
  border-radius: 2px;
  line-height: 1.2;
}
.tk-clip:focus {
  outline: none;
}
.tk-clip:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 3px;
}
.tk-clip.warn {
  color: var(--warning-text);
}
.tk-clip.error {
  color: var(--error-text);
}
/* Stepped, never transitioned: Winamp's ticker jumps a whole character at a time. */
.tk-strip {
  display: block;
  width: max-content;
  will-change: transform;
}
.tk-text {
  font-family: 'VT323', ui-monospace, monospace;
  white-space: pre;
}
/* Each character in a cell as wide as the step it makes, so the steps line up exactly. */
.g {
  display: inline-block;
  text-align: left;
  overflow: visible;
}
.tk-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.tk-message {
  margin: 0;
  min-height: 1.6em;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: normal;
}
.tk-message.warn {
  color: var(--warning-text);
}
.tk-message.muted {
  color: var(--muted);
}
</style>
