import { fileURLToPath, URL } from 'node:url'

import { defineConfig, runnerImport, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VAPOR_COMPONENTS } from './vapor.config'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '@core': fileURLToPath(new URL('../src', import.meta.url)),
  // The extension's manifest: settings and commands for the docs page.
  '@pkg': fileURLToPath(new URL('../package.json', import.meta.url)),
}

/**
 * `virtual:search-index`: the search's fixed documents and their MiniSearch index, built here in
 * Node (lib/searchStatic.ts, run through Vite's module runner) rather than in the page on first
 * use. Emitted as JSON strings that the page parses in parts (the quickest way to read big data).
 * Rebuilt when the wiki, the recipes, the search code or the extension's core change.
 */
function searchIndex(): Plugin {
  const ID = 'virtual:search-index'
  const RESOLVED = '\0' + ID
  const source = fileURLToPath(new URL('./src/lib/searchStatic.ts', import.meta.url))
  let code: Promise<string> | undefined
  const build = async () => {
    const { module } = await runnerImport<{ staticCorpus(): { docs: unknown; index: unknown } }>(source, {
      configFile: false,
      logLevel: 'error',
      resolve: { alias },
      server: { fs: { allow: ['..'] } },
    })
    const { docs, index } = module.staticCorpus() as { docs: unknown; index: { index: unknown[] } & Record<string, unknown> }
    // As JSON strings, parsed by the page a part at a time (lib/searchCorpus.ts), so loading the
    // module is instant and no single parse is a long task: the documents, the index without its
    // terms, and the terms in parts of 1,500.
    const { index: terms, ...rest } = index
    const parts: string[] = []
    for (let i = 0; i < terms.length; i += 1500) parts.push(JSON.stringify(terms.slice(i, i + 1500)))
    const str = (value: string) => JSON.stringify(value)
    return `export const docs = ${str(JSON.stringify(docs))}\nexport const meta = ${str(JSON.stringify(rest))}\nexport const termParts = [${parts.map(str).join(',')}]\n`
  }
  const affects = (file: string) => /[\\/]wiki[\\/][^\\/]+\.md$|[\\/]web[\\/]src[\\/]lib[\\/](recipes|search|searchStatic|settings)\.ts$|[\\/]atf-syntax[\\/]src[\\/]|[\\/]atf-syntax[\\/]package\.json$/.test(file)
  return {
    name: 'atf-search-index',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load(id) {
      if (id === RESOLVED) return (code ??= build())
    },
    hotUpdate({ file }) {
      if (!affects(file)) return
      code = undefined
      const mod = this.environment.moduleGraph.getModuleById(RESOLVED)
      if (mod) this.environment.moduleGraph.invalidateModule(mod)
    },
  }
}

/**
 * Vapor mode (`--mode vapor`, see vapor.config.ts): adds the `vapor` attribute to the `<script
 * setup>` of the listed components before plugin-vue compiles them. Runs only in that mode.
 */
function vaporComponents(files: readonly string[]): Plugin {
  const dir = fileURLToPath(new URL('./src/components/', import.meta.url)).replace(/\\/g, '/')
  const wanted = new Set(files.map((f) => dir + f))
  return {
    name: 'atf-vapor-components',
    enforce: 'pre',
    transform(code, id) {
      if (!wanted.has(id.replace(/\\/g, '/'))) return
      const out = code.replace(/<script setup lang="ts">/, '<script setup lang="ts" vapor>')
      if (out === code) this.warn(`${id}: no <script setup lang="ts"> to make Vapor`)
      // Only the <script setup> tag's own line changes (no code on it): the existing source map
      // still holds, so say so (map: null) rather than leave Rolldown to warn.
      return { code: out, map: null }
    },
  }
}

// The playground imports the extension's core (parser, linter, catalogue, evaluator) straight
// from ../src, so the VS Code extension and the web page always agree.
export default defineConfig(({ mode }) => ({
  base: './',
  // No component (ours or @lucide/vue's functional icons) uses the Options API: leave it out.
  plugins: [...(mode === 'vapor' ? [vaporComponents(VAPOR_COMPONENTS)] : []), vue({ features: { optionsAPI: false } }), searchIndex()],
  // false except in vapor mode, so every other build drops the Vapor interop (and runtime) entirely.
  define: { __VAPOR__: JSON.stringify(mode === 'vapor') },
  resolve: { alias },
  server: {
    fs: { allow: ['..'] },
  },
  build: {
    // Vapor builds go beside the real one, never over it (the Pages workflow deploys dist).
    outDir: mode === 'vapor' ? 'dist-vapor' : 'dist',
    // Source maps as separate .map files beside each chunk (the worker's too: it is built with the
    // same setting), linked by a sourceMappingURL comment; never inlined.
    sourcemap: true,
    // Two pages: the playground and the extension's documentation.
    rolldownOptions: {
      // @lezer/common is only there because @codemirror/commands imports one name from it for
      // commands the editor doesn't use; it has no side effects but doesn't say so, so without this
      // its whole module would stay in the editor chunk.
      treeshake: { moduleSideEffects: [{ test: /[\\/]node_modules[\\/]@lezer[\\/]common[\\/]/, sideEffects: false }] },
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        extension: fileURLToPath(new URL('./extension/index.html', import.meta.url)),
      },
    },
  },
  worker: {
    format: 'es',
  },
}))
