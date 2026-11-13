import { createApp } from 'vue'
import '../style.css'
import DocsPage from './DocsPage.vue'

createApp(DocsPage).mount('#app')

// Theme-switch fades only after the first paint (see html.theme-ready in style.css).
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('theme-ready')))
