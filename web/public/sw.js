// The playground's service worker: it makes the installed app work offline. Everything runs in the
// browser, so once a page and its files have loaded they are all it needs.
//
// - Pages (navigations) and other un-hashed files: network first, so you always get the newest
//   version when online; the cached copy only when offline.
// - Vite's hashed files (assets/*-<hash>.*): cache first. Their content never changes under a name,
//   and a new build links new names.
// - Other sites (Google's analytics) and anything but GET: not touched.
//
// Bump VERSION to drop every cached file (old builds' hashed files otherwise stay until then).
const VERSION = 'v1'
const CACHE = `atf-playground-${VERSION}`

self.addEventListener('install', (event) => {
  // The pages themselves, so the app opens offline even if only one of them was visited.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', './extension/', './manifest.webmanifest', './favicon.svg', './icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('atf-playground-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// The page sends the files it loaded before this worker controlled it (src/lib/serviceWorker.ts).
self.addEventListener('message', (event) => {
  const { type, urls } = event.data ?? {}
  if (type !== 'cache' || !Array.isArray(urls)) return
  const same = urls.filter((u) => typeof u === 'string' && new URL(u).origin === self.location.origin)
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        same.map(async (u) => {
          if (await cache.match(u)) return
          const res = await fetch(u).catch(() => undefined)
          if (res?.ok) await cache.put(u, res)
        }),
      ),
    ),
  )
})

const isHashed = (url) => /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(url.pathname)

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (isHashed(url)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const res = await fetch(request)
        if (res.ok) cache.put(request, res.clone())
        return res
      }),
    )
    return
  }
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return res
      })
      .catch(async () => (await caches.match(request, { ignoreSearch: request.mode === 'navigate' })) ?? Response.error()),
  )
})
