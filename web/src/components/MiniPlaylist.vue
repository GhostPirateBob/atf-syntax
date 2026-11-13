<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Row } from './TrackList.vue'
import type { ViewSettings } from '@/lib/view'
import { clampFontSize } from '@/lib/view'
import { titleFont } from '@/lib/fontStacks'
import { fitRow, fontsLoaded, useWidth } from '@/lib/rowFit'
import { NARROW, reducedMotion, useMedia } from '@/lib/media'

/**
 * The hero: a three-row WACUP playlist (previous, selected, next track), drawn at `zoom` times the
 * playlist's font size and width so it reads as a headline but cuts titles where the track list does.
 */
const props = defineProps<{
  rows: Row[]
  selected: number
  view: ViewSettings
  /** Shown in place of the rows, for states that aren't about one track. */
  message?: { text: string; tone: 'warn' | 'muted' }
}>()
const emit = defineEmits<{ select: [index: number] }>()

// 1.5 on wide screens; 1 on phones, where 1.5 leaves room for only a few letters of each title.
const narrow = useMedia(NARROW)
const zoom = computed(() => (narrow.value ? 1 : 1.5))
/** Row padding, borders and the scrollbar around the playlist width, in px. */
const CHROME = 2 * 10 + 2 * 1 + 8

const n = computed(() => props.rows.length)
const font = computed(() => titleFont(props.view.font, props.view.fontFamily))
const size = computed(() => clampFontSize(props.view.fontSize) * zoom.value)
// The rows' exact font, as a canvas font shorthand; boxStyle applies the same three values.
const cssFont = computed(() => `${font.value.weight} ${size.value}px ${font.value.family}`)
const boxStyle = computed(() => ({
  width: props.view.width ? `${props.view.width * zoom.value + CHROME}px` : '100%',
  fontFamily: font.value.family,
  fontWeight: font.value.weight,
  fontSize: `${size.value}px`,
}))

type Slot = { pos: 'prev' | 'current' | 'next'; index: number }
const slots = computed<Slot[]>(() => {
  const s = props.selected
  const many = n.value > 1
  return [
    { pos: 'prev', index: many ? (s - 1 + n.value) % n.value : -1 },
    { pos: 'current', index: n.value ? s : -1 },
    { pos: 'next', index: many ? (s + 1) % n.value : -1 },
  ]
})

const STATE_TEXT: Partial<Record<Row['state'], string>> = {
  freeze: '⚠ This would freeze WACUP',
  heavy: 'Too heavy to preview',
  timeout: "⚠ Didn't finish",
}
const prefix = (index: number) => (props.view.numbers && index >= 0 ? `${index + 1}. ` : '')

const currentRow = ref<HTMLElement>()
const width = useWidth(currentRow)
const shown = computed(() => {
  void fontsLoaded.value
  return slots.value.map(({ index }) => {
    const row = props.rows[index]
    if (!row) return { title: '', duration: '' }
    const special = STATE_TEXT[row.state]
    if (special) return { title: special, duration: row.duration }
    return { title: fitRow(row.text, { duration: row.duration, prefix: prefix(index), width: width.value, font: cssFont.value, gap: size.value * 0.4 }), duration: row.duration }
  })
})

const thumb = computed(() => {
  if (n.value <= 3) return undefined
  const h = Math.max(3 / n.value, 0.12)
  return { height: `${h * 100}%`, top: `${(props.selected / (n.value - 1)) * (1 - h) * 100}%` }
})

// A step to the next or previous track slides the rows by one, like scrolling a playlist.
const rowsEl = ref<HTMLElement>()
watch(
  () => props.selected,
  (now, before) => {
    const count = n.value
    if (count < 2 || props.message || reducedMotion() || !rowsEl.value) return
    const dir = now === (before + 1) % count ? 1 : now === (before - 1 + count) % count ? -1 : 0
    if (!dir) return
    const height = currentRow.value?.offsetHeight ?? 0
    for (const row of rowsEl.value.children) {
      ;(row as HTMLElement).animate([{ transform: `translateY(${dir * height}px)` }, { transform: 'none' }], { duration: 150, easing: 'ease-out' })
    }
  },
)

function step(by: number) {
  if (n.value > 1) emit('select', (props.selected + by + n.value) % n.value)
}
function onKey(e: KeyboardEvent) {
  const by = { ArrowUp: -1, ArrowDown: 1 }[e.key]
  if (by) step(by)
  else if (e.key === 'Home') emit('select', 0)
  else if (e.key === 'End') emit('select', n.value - 1)
  else return
  e.preventDefault()
}
// A mouse notch moves one track; trackpad scrolling adds up small deltas first.
let wheelSum = 0
let wheelTimer: ReturnType<typeof setTimeout> | undefined
function onWheel(e: WheelEvent) {
  if (n.value < 2 || props.message) return
  e.preventDefault()
  const d = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
  clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => (wheelSum = 0), 250)
  if (Math.abs(d) >= 50) {
    wheelSum = 0
    return step(Math.sign(d))
  }
  wheelSum += d
  if (Math.abs(wheelSum) >= 100) {
    step(Math.sign(wheelSum))
    wheelSum = 0
  }
}
</script>

<template>
  <div class="pl" :style="boxStyle" @wheel="onWheel">
    <p v-if="message" class="pl-message" :class="message.tone">{{ message.text }}</p>
    <div
      v-else
      ref="rowsEl"
      class="pl-rows"
      role="listbox"
      tabindex="0"
      aria-label="Preview playlist. Up and Down change the track."
      aria-activedescendant="pl-current"
      @keydown="onKey"
    >
      <div
        v-for="(s, k) in slots"
        :id="s.pos === 'current' ? 'pl-current' : undefined"
        :key="s.pos"
        :ref="s.pos === 'current' ? (el) => (currentRow = el as HTMLElement) : undefined"
        class="pl-row playlist-text"
        :class="[s.pos, rows[s.index]?.state]"
        role="option"
        :aria-selected="s.pos === 'current'"
        :title="rows[s.index] ? (s.pos === 'current' ? rows[s.index]!.text : `${s.pos === 'prev' ? 'Previous' : 'Next'} track: ${rows[s.index]!.label}`) : undefined"
        @click="s.index >= 0 && s.pos !== 'current' && emit('select', s.index)"
      >
        <span class="t"><span v-if="prefix(s.index)" class="num">{{ prefix(s.index) }}</span>{{ shown[k]?.title }}</span>
        <span v-if="shown[k]?.duration" class="dur">{{ shown[k]?.duration }}</span>
      </div>
    </div>
    <div v-if="thumb && !message" class="pl-scroll" aria-hidden="true"><span :style="thumb" /></div>
  </div>
</template>

<style scoped>
.pl {
  position: relative;
  max-width: 100%;
  margin: 0 auto;
  background: var(--playlist-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  box-shadow: 0 6px 22px var(--shadow);
  padding: 3px 8px 3px 0;
  text-align: left;
  line-height: 1.35;
}
.pl-rows {
  border-radius: 2px;
  /* Rows sliding in from a step stay inside the box. */
  overflow: hidden;
}
.pl-rows:focus {
  outline: none;
}
.pl-rows:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 1px;
}
/* All three rows share this class (plus the global .playlist-text) and inherit the box's font
   unchanged: cssFont, which the "..." cut is measured with, is built from the same values as boxStyle. */
.pl-row {
  display: flex;
  padding: 0 10px;
  color: var(--dim);
  white-space: pre;
  cursor: pointer;
}
.pl-row.prev:hover,
.pl-row.next:hover {
  color: var(--text);
}
.pl-row.current {
  background: var(--raised);
  color: var(--bright);
  cursor: default;
}
.t {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.dur {
  margin-left: 0.4em;
}
/* Per-track problems keep their colour, dimmer when not selected. */
.pl-row.freeze .t,
.pl-row.heavy .t,
.pl-row.timeout .t {
  color: var(--warning);
}
.pl-row.error .t {
  color: var(--error);
}
.pl-row:not(.current).freeze .t,
.pl-row:not(.current).heavy .t,
.pl-row:not(.current).error .t {
  opacity: 0.7;
}
.pl-message {
  margin: 0;
  /* Three rows tall, so the page doesn't jump between states. */
  min-height: calc(3 * 1.35em);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px 0 18px;
  white-space: normal;
}
.pl-message.warn {
  color: var(--warning);
}
.pl-message.muted {
  color: var(--muted);
}
.pl-scroll {
  position: absolute;
  top: 3px;
  bottom: 3px;
  right: 2px;
  width: 4px;
  border-radius: 2px;
  background: rgba(88, 110, 117, 0.15);
}
.pl-scroll span {
  position: absolute;
  left: 0;
  right: 0;
  border-radius: 2px;
  background: rgba(88, 110, 117, 0.55);
  transition: top 0.12s;
}
</style>
