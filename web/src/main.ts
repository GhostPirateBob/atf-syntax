import { createApp, vaporInteropPlugin } from 'vue'
import App from './App.vue'
import { loadEditor } from './lib/editorLoader'
import { isShareHash, loadShare } from './lib/shareLink'
import { registerServiceWorker } from './lib/serviceWorker'
import type { ShareState } from './lib/share'
import './fonts.css'
import './style.css'

// CodeMirror downloads while the page renders; until it's in, the format shows as static text
// (components/AtfEditor.vue), and the editor takes over just after the first paint.
loadEditor().catch(() => {
  /* the editor retries when it mounts */
})

function mount(shared?: ShareState) {
  const app = createApp(App, { shared })
  // Vapor mode only (vapor.config.ts): lets Vapor components render inside this app. A constant
  // false elsewhere, so the default build has no Vapor code at all.
  if (__VAPOR__) app.use(vaporInteropPlugin)
  app.mount('#app')
}
// A share link (#f=…) is read before the first render; only then does lz-string load at startup.
if (isShareHash(location.hash)) loadShare().then((s) => mount(s.decodeShare(location.hash)), () => mount())
else mount()
registerServiceWorker('./sw.js')
