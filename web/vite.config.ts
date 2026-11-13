import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The playground imports the extension's core (parser, linter, catalogue, evaluator) straight
// from ../src, so the VS Code extension and the web page always agree.
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@core': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['..'] },
  },
  worker: {
    format: 'es',
  },
})
