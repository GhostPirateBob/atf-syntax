import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The playground imports the extension's core (parser, linter, catalogue, evaluator) straight
// from ../src, so the VS Code extension and the web page always agree.
export default defineConfig({
  base: './',
  // No component (ours or @lucide/vue's functional icons) uses the Options API: leave it out.
  plugins: [vue({ features: { optionsAPI: false } })],
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
    // Source maps as separate .map files beside each chunk (the worker's too: it is built with the
    // same setting), linked by a sourceMappingURL comment; never inlined.
    sourcemap: true,
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
