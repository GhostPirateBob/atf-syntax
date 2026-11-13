import { createApp } from 'vue'
import App from './App.vue'
import { loadEditor } from './lib/editorLoader'
import { isShareHash, loadShare } from './lib/shareLink'
import type { ShareState } from './lib/share'
import './fonts.css'
import './style.css'

// CodeMirror downloads while the page renders; until it's in, the format shows as static text
// (components/AtfEditor.vue), and the editor takes over just after the first paint.
loadEditor().catch(() => {
  /* the editor retries when it mounts */
})

const mount = (shared?: ShareState) => createApp(App, { shared }).mount('#app')
// A share link (#f=…) is read before the first render; only then does lz-string load at startup.
if (isShareHash(location.hash)) loadShare().then((s) => mount(s.decodeShare(location.hash)), () => mount())
else mount()
