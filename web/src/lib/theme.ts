import { nextTick, ref } from 'vue'

export type Theme = 'light' | 'dark'

/** Kept in sync with public/theme-init.js, which applies the saved choice before first paint. */
const KEY = 'atf-playground:theme'

function saved(): Theme | undefined {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : undefined
  } catch {
    return undefined
  }
}

const system = window.matchMedia('(prefers-color-scheme: light)')
let picked = saved()
/** The theme in effect: the user's pick, or the system preference until they pick. */
export const theme = ref<Theme>(picked ?? (system.matches ? 'light' : 'dark'))
system.addEventListener('change', (e) => {
  if (!picked) theme.value = e.matches ? 'light' : 'dark'
})

/**
 * Switches theme. Where the View Transitions API exists (and motion isn't reduced), the browser
 * cross-fades snapshots of the old and new page on the compositor; elsewhere it's instant.
 */
export function setTheme(t: Theme): void {
  picked = t
  const apply = () => {
    theme.value = t
    document.documentElement.dataset.theme = t
    return nextTick()
  }
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply)
  else void apply()
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* private window: the choice lasts until the page closes */
  }
}
