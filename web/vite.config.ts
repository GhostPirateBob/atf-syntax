import { fileURLToPath, URL } from 'node:url'

import { defineConfig, runnerImport, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '@core': fileURLToPath(new URL('../src', import.meta.url)),
  // The extension's manifest: settings and commands for the docs page.
  '@pkg': fileURLToPath(new URL('../package.json', import.meta.url)),
}

/**
 * `virtual:search-index`: the search's fixed documents and their MiniSearch index, built here in
 * Node (lib/searchStatic.ts, run through Vite's module runner) rather than in the page on first
 * use. Emitted as JSON.parse() of string literals, the quickest way for the page to read big data.
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
    const { docs, index } = module.staticCorpus()
    const literal = (value: unknown) => `JSON.parse(${JSON.stringify(JSON.stringify(value))})`
    return `export const docs = ${literal(docs)}\nexport const index = ${literal(index)}\n`
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

// The playground imports the extension's core (parser, linter, catalogue, evaluator) straight
// from ../src, so the VS Code extension and the web page always agree.
export default defineConfig({
  base: './',
  // No component (ours or @lucide/vue's functional icons) uses the Options API: leave it out.
  plugins: [vue({ features: { optionsAPI: false } }), searchIndex()],
  resolve: { alias },
  server: {
    fs: { allow: ['..'] },
  },
  build: {
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
})
