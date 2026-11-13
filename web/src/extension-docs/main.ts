import { createApp } from 'vue'
import '../fonts.css'
import '../style.css'
import DocsPage from './DocsPage.vue'
import { registerServiceWorker } from '@/lib/serviceWorker'

createApp(DocsPage).mount('#app')
registerServiceWorker('../sw.js')
