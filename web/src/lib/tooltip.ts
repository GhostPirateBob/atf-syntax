import type { Directive } from 'vue'

/**
 * `v-tip="text"`: the page's tooltips, one shared element positioned by Floating UI (loaded on
 * first use, or when the page is idle: see prefetchTooltip). Accessible per WCAG 1.4.13: it shows
 * on mouse hover (after a short delay) and on keyboard focus, stays while the pointer is over the
 * target or the tooltip itself, and Escape dismisses it. When its text adds to the target's
 * accessible name (not just repeats an icon button's aria-label), the target points at it with
 * aria-describedby while it shows. Touch taps don't open it (the label is the accessible name).
 */

const ID = 'atf-tip'
const SHOW_DELAY = 350
const HIDE_DELAY = 120

interface TipTarget extends HTMLElement {
  __tip?: { text: string; off: () => void }
}

let floating: Promise<typeof import('@floating-ui/dom')> | undefined
const loadFloating = () =>
  (floating ??= import('@floating-ui/dom').catch((e: unknown) => {
    floating = undefined
    throw e
  }))
/** Fetches Floating UI ahead of the first tooltip (call when the page is idle). */
export const prefetchTooltip = () => void loadFloating().catch(() => {})

let tip: HTMLDivElement | undefined
let current: TipTarget | undefined
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined

function element(): HTMLDivElement {
  if (tip) return tip
  tip = document.createElement('div')
  tip.id = ID
  tip.className = 'atf-tip'
  tip.setAttribute('role', 'tooltip')
  tip.hidden = true
  // Hoverable: moving onto the tooltip keeps it.
  tip.addEventListener('pointerenter', () => clearTimeout(hideTimer))
  tip.addEventListener('pointerleave', () => scheduleHide())
  document.body.appendChild(tip)
  return tip
}

/** Whether the tooltip says more than the target's accessible name already does. */
function adds(target: HTMLElement, text: string): boolean {
  const name = (target.getAttribute('aria-label') ?? target.textContent ?? '').trim().toLowerCase()
  return text.trim().toLowerCase() !== name
}

function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !current) return
  hide()
  e.preventDefault()
  e.stopPropagation()
}

async function show(target: TipTarget) {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  const text = target.__tip?.text
  if (!text || !target.isConnected) return
  if (current && current !== target) hide()
  current = target
  const el = element()
  el.textContent = text
  if (adds(target, text)) target.setAttribute('aria-describedby', ID)
  document.addEventListener('keydown', onEscape, true)
  let lib: typeof import('@floating-ui/dom')
  try {
    lib = await loadFloating()
  } catch {
    return
  }
  if (current !== target) return
  // Placed while invisible, then faded in, so it never shows in the wrong spot.
  el.classList.remove('on')
  el.hidden = false
  const { x, y } = await lib.computePosition(target, el, {
    strategy: 'fixed',
    placement: 'bottom',
    middleware: [lib.offset(6), lib.flip({ padding: 8 }), lib.shift({ padding: 8 })],
  })
  if (current !== target) return
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  el.classList.add('on')
}

function hide() {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  if (current?.getAttribute('aria-describedby') === ID) current.removeAttribute('aria-describedby')
  current = undefined
  document.removeEventListener('keydown', onEscape, true)
  if (tip) {
    tip.classList.remove('on')
    tip.hidden = true
  }
}
function scheduleHide() {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hide, HIDE_DELAY)
}

function bind(el: TipTarget, text: string) {
  const enter = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    clearTimeout(hideTimer)
    if (current === el) return
    clearTimeout(showTimer)
    showTimer = setTimeout(() => void show(el), current ? 0 : SHOW_DELAY)
  }
  const leave = () => (current === el ? scheduleHide() : clearTimeout(showTimer))
  const focus = () => el.matches(':focus-visible') && void show(el)
  const blur = () => current === el && hide()
  const down = () => current === el && hide()
  el.addEventListener('pointerenter', enter)
  el.addEventListener('pointerleave', leave)
  el.addEventListener('focus', focus)
  el.addEventListener('blur', blur)
  el.addEventListener('pointerdown', down)
  el.__tip = {
    text,
    off: () => {
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('focus', focus)
      el.removeEventListener('blur', blur)
      el.removeEventListener('pointerdown', down)
    },
  }
}

export const vTip: Directive<TipTarget, string | undefined> = {
  mounted(el, { value }) {
    bind(el, value ?? '')
  },
  updated(el, { value }) {
    if (!el.__tip || el.__tip.text === (value ?? '')) return
    el.__tip.text = value ?? ''
    if (current === el) {
      if (!value) hide()
      else {
        element().textContent = value
        if (adds(el, value)) el.setAttribute('aria-describedby', ID)
        else el.removeAttribute('aria-describedby')
      }
    }
  },
  beforeUnmount(el) {
    if (current === el) hide()
    el.__tip?.off()
    delete el.__tip
  },
}
