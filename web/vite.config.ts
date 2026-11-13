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
      // The extension's manifest: settings and commands for the docs page.
      '@pkg': fileURLToPath(new URL('../package.json', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['..'] },
  },
  build: {
    // Two pages: the playground and the extension's documentation.
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        extension: fileURLToPath(new URL('./extension/index.html', import.meta.url)),
      },
    },
  },
  worker: {
    format: 'es',
  },
})
