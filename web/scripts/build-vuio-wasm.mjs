// Builds the tag reader (tag-reader/, Rust) to WebAssembly and copies it to src/wasm/, with
// LICENSES.txt: the licence of every Rust crate compiled into the module, for
// make-third-party-notices.mjs. Needs Rust with the wasm32-unknown-unknown target:
//   rustup target add wasm32-unknown-unknown
//   npm run build:wasm
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'

const web = join(import.meta.dirname, '..')
const crate = join(web, 'tag-reader')
const outDir = join(web, 'src', 'wasm')
const TARGET = 'wasm32-unknown-unknown'

// Panic messages carry source paths: write them relative to fixed roots, so the module names no
// local directories and builds the same wherever it's built.
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo')
const rustflags = [`--remap-path-prefix=${cargoHome}=/cargo`, `--remap-path-prefix=${crate}=/tag-reader`]
const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: rustflags.join('\x1f') }
delete env.RUSTFLAGS

// cdylib only: Cargo.toml adds an rlib for the tests, and building both keeps ~24 KB of code
// that LTO otherwise drops.
execFileSync('cargo', ['rustc', '--release', '--target', TARGET, '--lib', '--crate-type', 'cdylib'], { cwd: crate, env, stdio: 'inherit' })
mkdirSync(outDir, { recursive: true })
const wasm = join(outDir, 'vuio_media_info.wasm')
copyFileSync(join(crate, 'target', TARGET, 'release', 'vuio_media_info.wasm'), wasm)

// The crates linked into the module: the tag reader and its normal dependencies, transitively,
// for the wasm target. Proc-macro crates (thiserror-impl, syn, ...) run at build time only.
const meta = JSON.parse(
  execFileSync('cargo', ['metadata', '--format-version', '1', '--filter-platform', TARGET], { cwd: crate, encoding: 'utf8', maxBuffer: 1 << 27 }),
)
const packages = new Map(meta.packages.map((p) => [p.id, p]))
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
const linked = new Set()
const queue = [meta.resolve.root]
while (queue.length) {
  const id = queue.shift()
  if (linked.has(id)) continue
  const pkg = packages.get(id)
  if (pkg.targets.some((t) => t.kind.includes('proc-macro'))) continue
  linked.add(id)
  for (const dep of nodes.get(id).deps) {
    if (dep.dep_kinds.some((k) => k.kind === null)) queue.push(dep.pkg)
  }
}

const sections = [...linked]
  .map((id) => packages.get(id))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((pkg) => {
    const dir = dirname(pkg.manifest_path)
    const files = readdirSync(dir)
      .filter((f) => /^(licen[cs]e|copying|unlicense|notice)/i.test(f) && statSync(join(dir, f)).isFile())
      .sort()
    const texts = files.map((f) => `${f}\n\n${readFileSync(join(dir, f), 'utf8').trim().replace(/\r\n/g, '\n')}`)
    return `${pkg.name} ${pkg.version} (${pkg.license ?? 'unknown'})\n${'-'.repeat(60)}\n${texts.join('\n\n') || `License: ${pkg.license}`}`
  })
writeFileSync(join(outDir, 'LICENSES.txt'), sections.join('\n\n\n') + '\n')
console.log(`wrote ${relative(web, wasm)} (${(statSync(wasm).size / 1024).toFixed(0)} KB) and LICENSES.txt (${sections.length} crates)`)
