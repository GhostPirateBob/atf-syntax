// Write public/third-party-notices.txt: the licence of every package the built site actually
// contains, since minified bundles and MediaInfoLib's .wasm drop the licence comments.
// It runs a throwaway production build and records which node_modules packages the bundler
// pulled in, so dev tools and platform-specific binaries never appear. Run from web/ after
// changing dependencies:  node scripts/make-third-party-notices.mjs
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { build } from 'vite'

const web = join(import.meta.dirname, '..')
const used = new Set()
const outDir = mkdtempSync(join(tmpdir(), 'atf-notices-'))

/** node_modules package directory for a module id, or undefined. */
function packageDir(id) {
  const path = id.split('?')[0].replace(/\//g, sep)
  const at = path.lastIndexOf(`${sep}node_modules${sep}`)
  if (at < 0) return undefined
  const rest = path.slice(at + 14).split(sep)
  const name = rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1)
  return join(path.slice(0, at + 14), ...name)
}

await build({
  root: web,
  logLevel: 'error',
  build: { outDir, emptyOutDir: true },
  plugins: [
    {
      name: 'collect-packages',
      enforce: 'post',
      load(id) {
        const dir = packageDir(id)
        if (dir) used.add(dir)
        return null
      },
    },
  ],
})
rmSync(outDir, { recursive: true, force: true })

const sections = [...used]
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
  .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))
  .map(({ dir, pkg }) => {
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
    const text = file ? readFileSync(join(dir, file), 'utf8').trim().replace(/\r\n/g, '\n') : `License: ${pkg.license ?? 'unknown'} (no licence file in the package)`
    return `${pkg.name} ${pkg.version} (${pkg.license ?? 'unknown'})\n${'-'.repeat(60)}\n${text}`
  })

const header =
  'Third-party software in the ATF playground\n' +
  '==========================================\n\n' +
  'The playground (https://github.com/GhostPirateBob/atf-syntax, web/) contains the packages below.\n' +
  'mediainfo.js includes MediaInfoLib by MediaArea.net SARL, compiled to WebAssembly; see also\n' +
  'https://mediaarea.net/en/MediaInfo/License for the libraries MediaInfoLib itself uses.\n\n'
const target = join(web, 'public', 'third-party-notices.txt')
writeFileSync(target, header + sections.join('\n\n\n') + '\n')
console.log(`wrote ${relative(web, target)} (${sections.length} packages)`)
