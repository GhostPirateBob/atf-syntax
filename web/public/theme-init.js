// The saved light/dark choice, applied before first paint so the page never flashes the other
// theme. No saved choice: style.css follows the system preference. See src/lib/theme.ts.
;(function () {
  try {
    var t = localStorage.getItem('atf-playground:theme')
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
  } catch (e) {
    /* storage blocked: follow the system */
  }
})()
