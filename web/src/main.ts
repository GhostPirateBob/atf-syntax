import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')

// Theme-switch fades only after the first paint (see html.theme-ready in style.css).
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('theme-ready')))
