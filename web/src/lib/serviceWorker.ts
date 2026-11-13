import { whenIdle } from './timing'

/**
 * Registers public/sw.js (offline use for the installed app), in production builds only: on the
 * dev server a cached page would only get in the way. Once the page has loaded and gone idle, so
 * it never competes with the first render. `script` is sw.js relative to the page (the docs page
 * sits a folder down); its scope is the folder sw.js is in, which covers both pages.
 */
export function registerServiceWorker(script: string): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const register = () =>
    whenIdle(() => {
      navigator.serviceWorker
        .register(new URL(script, location.href))
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          // The page's own scripts, styles and fonts loaded before the worker was there to see
          // them: hand it the list, so the first visit is already enough to work offline.
          const urls = performance
            .getEntriesByType('resource')
            .map((e) => e.name)
            .filter((u) => u.startsWith(location.origin))
          reg.active?.postMessage({ type: 'cache', urls: [location.href.split('#')[0], ...urls] })
        })
        .catch(() => {
          /* no offline copy: the page works as before */
        })
    }, 5000)
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
