import { ref } from 'vue'

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

export function setTheme(t: Theme): void {
  picked = t
  theme.value = t
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* private window: the choice lasts until the page closes */
  }
}
