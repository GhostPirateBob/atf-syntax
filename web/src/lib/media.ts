import { onBeforeUnmount, ref, type Ref } from 'vue'

/** Phones and other narrow screens: icon-only buttons, a stacked parts table, zoom 1 previews. */
export const NARROW = '(max-width: 640px)'

/** A media query as a ref that follows it. Call from setup. */
export function useMedia(query: string): Ref<boolean> {
  const mq = window.matchMedia(query)
  const matches = ref(mq.matches)
  const onChange = (e: MediaQueryListEvent) => (matches.value = e.matches)
  mq.addEventListener('change', onChange)
  onBeforeUnmount(() => mq.removeEventListener('change', onChange))
  return matches
}

/** True when the user asked for less motion: jump instead of animating. */
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
