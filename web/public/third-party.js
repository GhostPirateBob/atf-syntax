// Google Fonts + the Google tag (gtag.js), only for visitors outside the GDPR area (EU-27 +
// Iceland, Liechtenstein, Norway), looked up from our own endpoint. If the lookup fails or is slow,
// they load anyway. Analytics never loads on localhost. Shared by every page; loaded as a classic
// script so it runs before the app.
;(function () {
  var GDPR = 'AT BE BG HR CY CZ DK EE FI FR DE GR EL HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO'.split(' ')
  var FONTS =
    'https://fonts.googleapis.com/css2?family=Exo:ital,wght@0,100..900;1,100..900' +
    '&family=Iosevka+Charon+Mono:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700' +
    '&family=Roboto+Condensed:ital,wght@0,100..900;1,100..900&display=swap'
  var host = location.hostname
  var local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === ''

  function loadFonts() {
    var l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = FONTS
    document.head.appendChild(l)
  }
  // Google tag (gtag.js), the owner's snippet: GA4 only, no Tag Manager.
  function loadAnalytics() {
    if (local) return
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
  function decide(country) {
    if (GDPR.indexOf(country) >= 0) return
    loadFonts()
    loadAnalytics()
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
