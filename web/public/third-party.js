// The Google tag (gtag.js), only for visitors outside the GDPR area (EU-27 + Iceland, Liechtenstein,
// Norway), looked up from our own endpoint. If the lookup fails or is slow, it loads anyway.
// Analytics never loads on localhost, and elsewhere only once the page has loaded and is idle.
// Shared by every page; loaded async, as nothing waits for it.
// (The web fonts are self-hosted: see src/fonts.css.)
;(function () {
  var GDPR = 'AT BE BG HR CY CZ DK EE FI FR DE GR EL HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO'.split(' ')
  var host = location.hostname
  var local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === ''
  // Analytics never loads locally, so there's nothing to look up.
  if (local) return

  // Google tag (gtag.js), the owner's snippet: GA4 only, no Tag Manager.
  function loadAnalytics() {
    var g = document.createElement('script')
    g.async = true
    g.src = 'https://www.googletagmanager.com/gtag/js?id=G-TWHQ9H3BBQ'
    document.head.appendChild(g)
    window.dataLayer = window.dataLayer || []
    window.gtag = function () {
      window.dataLayer.push(arguments)
    }
    window.gtag('js', new Date())
    window.gtag('config', 'G-TWHQ9H3BBQ')
  }
  // Google's script waits for the page: after the load event, when the main thread is idle (at
  // most 4 s later), so it never competes with the first render.
  function whenIdle(run) {
    function idle() {
      if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 4000 })
      else setTimeout(run, 1)
    }
    if (document.readyState === 'complete') idle()
    else window.addEventListener('load', idle, { once: true })
  }
  function decide(country) {
    if (GDPR.indexOf(country) >= 0) return
    whenIdle(loadAnalytics)
  }

  var cached = null
  try {
    cached = sessionStorage.getItem('atf-playground:country')
  } catch (e) {}
  if (cached !== null) return decide(cached)

  var settled = false
  function settle(country, remember) {
    if (settled) return
    settled = true
    if (remember) {
      try {
        sessionStorage.setItem('atf-playground:country', country)
      } catch (e) {}
    }
    decide(country)
  }
  var timer = setTimeout(function () {
    settle('', false)
  }, 1500)
  fetch('https://monkeyisland.app/ip/', { cache: 'no-store' })
    .then(function (r) {
      return r.json()
    })
    .then(function (j) {
      clearTimeout(timer)
      settle(String((j && j.country) || '').toUpperCase(), true)
    })
    .catch(function () {
      clearTimeout(timer)
      settle('', false)
    })
})()
