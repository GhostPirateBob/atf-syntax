<script setup lang="ts">
// Documentation for the VS Code extension, generated from the same tables the extension uses
// (lint rules, the function/field catalogue, package.json settings), so it can't drift. Every
// section, setting, rule, function and field has a stable anchor for hard links.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { FIELDS, FUNCTIONS, REMOVED, RULES } from '@/core'
import type { FunctionInfo } from '@/core'
import { docMarkdown } from '@/lib/markdown'
import { settingsFrom } from '@/lib/settings'
import { useScrolled } from '@/lib/scrolled'
import HighlightedFormat from '@/components/HighlightedFormat.vue'
import OmniSearch from '@/components/OmniSearch.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import pkg from '@pkg'

const contributes = (pkg as any).contributes ?? {}
const settings = settingsFrom(pkg)
const commands: { command: string; title: string; category?: string }[] = contributes.commands ?? []
const version: string = (pkg as any).version

const rules = Object.values(RULES)

const KIND_TITLES: Record<FunctionInfo['kind'], string> = {
  control: 'Control flow',
  variable: 'Variables',
  function: 'Functions',
}
const query = ref('')
const groups = computed(() => {
  const q = query.value.trim().toLowerCase().replace(/^\$/, '')
  return (['control', 'variable', 'function'] as const)
    .map((kind) => ({
      kind,
      title: KIND_TITLES[kind],
      items: FUNCTIONS.filter((f) => f.kind === kind && (!q || f.name.includes(q) || f.doc.toLowerCase().includes(q))),
    }))
    .filter((g) => g.items.length)
})
const fields = computed(() => {
  const q = query.value.trim().toLowerCase().replace(/%/g, '')
  return FIELDS.filter((f) => !q || f.name.includes(q) || f.doc.toLowerCase().includes(q))
})

function arity(f: FunctionInfo): string {
  if (f.exact !== undefined) return `exactly ${f.exact} argument${f.exact === 1 ? '' : 's'}`
  const parts: string[] = []
  if (f.min !== undefined) parts.push(`at least ${f.min}`)
  if (f.max !== undefined) parts.push(`at most ${f.max}${f.maxWinamp !== undefined ? ` (Winamp 5: ${f.maxWinamp})` : ''}`)
  return parts.length ? parts.join(', ') + ' arguments' : ''
}
const dialectLabel = (f: FunctionInfo) => (f.only === 'wacup' ? 'WACUP only' : f.only === 'winamp' ? 'Winamp 5 only' : '')
const showDefault = (v: unknown) => (v === undefined ? '' : JSON.stringify(v))

// A link (or a search result) to a function or field the filter is hiding: clear the filter.
function showHashTarget() {
  const id = decodeURIComponent(location.hash.slice(1))
  if (!id || document.getElementById(id) || !query.value) return
  query.value = ''
  // :target is fixed when the hash changes, so navigate to it again now that the entry exists.
  void nextTick(() => location.replace(`#${encodeURIComponent(id)}`))
}
const scrolled = useScrolled()
onMounted(() => window.addEventListener('hashchange', showHashTarget))
onBeforeUnmount(() => window.removeEventListener('hashchange', showHashTarget))

const SAMPLE = '[%artist% ▸ ]$if2(%title%,$filepart(%filename%))'
const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=gpb.atf-syntax'
const REPO = 'https://github.com/GhostPirateBob/atf-syntax'
const WIKI = `${REPO}/wiki`
</script>

<template>
  <header class="docs-top" :class="{ scrolled }">
    <a class="docs-brand" href="../" aria-label="ATF for VS Code: extension docs. Back to the atf playground" title="Back to the atf playground">
      <span class="docs-title">ATF for VS Code</span>
      <span class="docs-tagline">Extension docs</span>
    </a>
    <OmniSearch class="docs-search" page="docs" />
    <ThemeToggle class="docs-theme" />
  </header>
  <div class="docs">
    <nav class="toc" aria-label="Contents">
      <a class="home" href="../">← atf playground</a>
      <p class="toc-title">ATF for VS Code <span class="muted">v{{ version }}</span></p>
      <a href="#install">Install</a>
      <a href="#features">Features</a>
      <a href="#atf-files">.atf files</a>
      <a href="#commands">Commands</a>
      <a href="#settings">Settings</a>
      <a href="#rules">Lint rules</a>
      <a href="#functions">Functions</a>
      <a href="#fields">Fields</a>
      <a href="#removed">Removed functions</a>
      <a href="#limitations">Known limitations</a>
    </nav>

    <main>
      <header>
        <h1>ATF for VS Code</h1>
        <p class="lede">
          Language support for <strong>WACUP / Winamp Advanced Title Formatting</strong> (ATF, a.k.a. <em>tagz</em>): the
          format strings behind playlist titles, the song ticker and the taskbar text.
        </p>
        <p class="sample"><HighlightedFormat :format="SAMPLE" /></p>
        <p class="links">
          <a :href="MARKETPLACE" target="_blank" rel="noopener">Marketplace</a>
          <a :href="REPO" target="_blank" rel="noopener">GitHub</a>
          <a :href="WIKI" target="_blank" rel="noopener">Wiki</a>
          <a href="../">Try formats in the playground</a>
        </p>
      </header>

      <section id="install">
        <h2><a href="#install">Install</a></h2>
        <p>From the <a :href="MARKETPLACE" target="_blank" rel="noopener">Visual Studio Marketplace</a>, or:</p>
        <pre><code>code --install-extension gpb.atf-syntax</code></pre>
      </section>

      <section id="features">
        <h2><a href="#features">Features</a></h2>
        <p>
          ATF is hard to debug inside the player: one stray character turns every title into
          <code>[SYNTAX ERROR IN FORMATTING STRING (4)]</code> with no hint where it is. The extension's parser behaves like
          WACUP's, so it reports the same errors <em>and</em> points at the cause.
        </p>
        <ul>
          <li><strong>Highlighting</strong>: fields, functions (control flow, variables and the rest coloured separately), <code>'literals'</code>, the <code>%% $$ ''</code> escapes, <code>[conditional]</code> sections and integer arguments. Bare <code>(</code> <code>)</code> <code>]</code> are marked invalid.</li>
          <li><strong>WACUP-accurate errors</strong>: the same error codes as WACUP, plus the culprit, e.g. <em>no balanced ')' for $puts( — unclosed '[' at column 61</em>.</li>
          <li><strong>{{ rules.length }} <a href="#rules">lint rules</a></strong>: formats that freeze WACUP, unknown and removed functions, argument counts, always-true or always-false conditions, <code>$get</code> before <code>$puts</code>, unknown fields and more. Each rule's severity is configurable.</li>
          <li><strong>Hovers and completion</strong>: signatures and docs after <code>$</code>, the field list after <code>%</code>, including undocumented WACUP extras.</li>
          <li><strong>Lossless formatting</strong>: <em>Format Document</em> wraps long formats onto several lines without changing their output.</li>
          <li><strong>Copy Format as Single Line</strong>: puts the format at the cursor on the clipboard as one line, ready for WACUP's preferences.</li>
          <li><strong>Two dialects</strong>: WACUP 1.99.x (default) and classic Winamp 5.</li>
        </ul>
      </section>

      <section id="atf-files">
        <h2><a href="#atf-files">.atf files</a></h2>
        <p>ATF itself has no comments or line breaks, so <code>.atf</code> files use a simple convention:</p>
        <ul>
          <li>a <code>#</code> in column 0 starts a comment line;</li>
          <li>a blank line separates formats;</li>
          <li>consecutive lines are <strong>joined with nothing in between</strong> into one format.</li>
        </ul>
      </section>

      <section id="commands">
        <h2><a href="#commands">Commands</a></h2>
        <dl>
          <template v-for="c in commands" :key="c.command">
            <dt :id="`cmd-${c.command}`"><a :href="`#cmd-${c.command}`">{{ c.category ? `${c.category}: ` : '' }}{{ c.title }}</a> <code class="muted">{{ c.command }}</code></dt>
            <dd v-if="c.command === 'atf.copySingleLine'">Copies the format at the cursor as one line, and warns if it would freeze WACUP.</dd>
          </template>
        </dl>
        <p class="muted">Plus VS Code's own <em>Format Document</em>, which uses <a href="#setting-atf.format.lineWidth"><code>atf.format.lineWidth</code></a>.</p>
      </section>

      <section id="settings">
        <h2><a href="#settings">Settings</a></h2>
        <div v-for="s in settings" :id="`setting-${s.key}`" :key="s.key" class="entry">
          <h3>
            <a :href="`#setting-${s.key}`"><code>{{ s.key }}</code></a>
            <span class="meta">{{ s.type }}<template v-if="s.default !== undefined">, default <code>{{ showDefault(s.default) }}</code></template></span>
          </h3>
          <p v-html="docMarkdown(s.description)" />
          <p v-if="s.enum" class="meta">One of: <code v-for="e in s.enum" :key="e" class="enum">{{ e }}</code></p>
        </div>
      </section>

      <section id="rules">
        <h2><a href="#rules">Lint rules</a></h2>
        <p>
          Change a rule's severity, or turn it off, with <a href="#setting-atf.lint.rules"><code>atf.lint.rules</code></a>,
          e.g. <code>{ "unknown-field": "off" }</code>.
        </p>
        <table class="rules">
          <thead>
            <tr><th>Rule</th><th>Default</th><th>What it flags</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rules" :id="`rule-${r.id}`" :key="r.id">
              <td><a :href="`#rule-${r.id}`"><code>{{ r.id }}</code></a></td>
              <td><span class="sev" :class="r.severity">{{ r.severity }}</span></td>
              <td v-html="docMarkdown(r.description)" />
            </tr>
          </tbody>
        </table>
      </section>

      <section id="functions">
        <h2><a href="#functions">Functions</a></h2>
        <input v-model="query" class="filter" type="search" placeholder="Filter functions and fields…" aria-label="Filter functions and fields" />
        <template v-for="g in groups" :key="g.kind">
          <h3 class="group">{{ g.title }} <span class="muted">({{ g.items.length }})</span></h3>
          <div v-for="f in g.items" :id="`fn-${f.name}`" :key="f.name" class="entry">
            <h4>
              <a :href="`#fn-${f.name}`"><code class="fn">${{ f.name }}{{ f.sig }}</code></a>
              <span v-if="dialectLabel(f)" class="badge">{{ dialectLabel(f) }}</span>
              <span v-if="arity(f)" class="meta">{{ arity(f) }}</span>
            </h4>
            <p v-html="docMarkdown(f.doc)" />
          </div>
        </template>
      </section>

      <section id="fields">
        <h2><a href="#fields">Fields</a></h2>
        <div v-for="f in fields" :id="`field-${f.name}`" :key="f.name" class="entry">
          <h4><a :href="`#field-${f.name}`"><code class="field">%{{ f.name }}%</code></a></h4>
          <p v-html="docMarkdown(f.doc)" />
        </div>
      </section>

      <section id="removed">
        <h2><a href="#removed">Removed functions</a></h2>
        <p>Documented in older references, but not callable: they print <code>[UNKNOWN FUNCTION]</code>.</p>
        <div v-for="(doc, name) in REMOVED" :id="`fn-${name}`" :key="name" class="entry">
          <h4><a :href="`#fn-${name}`"><code class="fn">${{ name }}</code></a></h4>
          <p v-html="docMarkdown(doc)" />
        </div>
      </section>

      <section id="limitations">
        <h2><a href="#limitations">Known limitations</a></h2>
        <ul>
          <li>The extension checks structure, not output: it doesn't evaluate formats, so it can't catch logic errors like a wrong <code>$left</code> length. The <a href="../">playground</a> does evaluate them.</li>
          <li>The <code>%length%</code> unit depends on where the format is used (<code>m:ss</code> in the WACUP playlist, milliseconds in Winamp 5 and WACUP's taskbar text).</li>
          <li><code>$rating</code> and <code>$bitdepth</code> need a running player, so their docs come from reading WACUP's code rather than from running it.</li>
        </ul>
      </section>

      <footer>
        <span>Generated from the extension's own tables, v{{ version }}.</span> <span><a href="https://github.com/GhostPirateBob/atf-syntax/wiki" target="_blank" rel="noopener">Wiki</a></span> <span><a href="../third-party-notices.txt">Third-party notices</a></span> <span>Not affiliated with or endorsed by WACUP or Winamp.</span>
      </footer>
    </main>
  </div>
</template>

<style scoped>
/* One row, stuck to the top, like the playground's. */
.docs-top {
  position: sticky;
  top: 0;
  z-index: 15;
  display: grid;
  grid-template-columns: minmax(max-content, 1fr) minmax(160px, 440px) minmax(max-content, 1fr);
  align-items: center;
  gap: 10px;
  min-height: var(--header-h);
  padding: 6px 16px;
  background: var(--chrome-bg);
  border-bottom: 1px solid var(--border);
  /* Secondary text readable on the raised chrome (see --muted-raised in style.css). */
  --muted: var(--muted-raised);
  --dim: var(--muted-raised);
}
.docs-top.scrolled {
  box-shadow: 0 2px 14px var(--shadow);
}
.docs-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  line-height: 1.15;
  text-decoration: none;
  min-width: 0;
}
.docs-title {
  font-family: var(--mono);
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--blue);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.docs-tagline {
  max-width: 11rem;
  font-size: 0.65rem;
  color: var(--muted);
}
.docs-brand:hover .docs-title {
  text-decoration: underline;
}
.docs-brand:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 2px;
  border-radius: 2px;
}
.docs-theme {
  justify-self: end;
}
.docs {
  position: relative;
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  max-width: 1180px;
  margin: 0 auto;
  gap: 32px;
  padding: 0 16px;
}
.toc {
  position: sticky;
  top: var(--header-h);
  align-self: start;
  max-height: calc(100vh - var(--header-h));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 28px 0;
}
.toc a {
  color: var(--text);
  text-decoration: none;
}
.toc a:hover {
  color: var(--bright);
}
.toc .home {
  color: var(--teal);
  margin-bottom: 10px;
}
.toc-title {
  margin: 0 0 6px;
  color: var(--bright);
  font-weight: 600;
}
main {
  padding: 24px 0 64px;
  min-width: 0;
}
h1 {
  font-family: var(--mono);
  color: var(--blue);
  font-size: 2.6rem;
  margin: 0 0 8px;
}
.lede {
  font-size: 1.1rem;
  max-width: 70ch;
}
.sample {
  font-family: var(--mono);
  font-size: 1.05rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  overflow-x: auto;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}
section {
  border-top: 1px solid var(--border);
  margin-top: 36px;
  padding-top: 8px;
  scroll-margin-top: 12px;
}
h2 a,
h3 a,
h4 a {
  color: inherit;
  text-decoration: none;
}
h2 a:hover::after,
h3 a:hover::after,
h4 a:hover::after {
  content: ' #';
  color: var(--dim);
}
h2 {
  color: var(--bright);
}
.group {
  color: var(--gold);
  margin-top: 28px;
}
.entry {
  padding: 6px 0 2px;
  scroll-margin-top: 12px;
}
.entry h3,
.entry h4 {
  margin: 8px 0 2px;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  font-weight: normal;
}
.entry p {
  margin: 2px 0 6px;
  max-width: 80ch;
}
.entry:target,
tr:target {
  background: rgba(42, 161, 152, 0.12);
  outline: 1px solid var(--teal);
  border-radius: 4px;
}
.meta {
  color: var(--muted);
  font-size: 0.9em;
}
.enum + .enum {
  margin-left: 6px;
}
.badge {
  font-size: 0.78em;
  color: var(--violet);
  border: 1px solid var(--violet);
  border-radius: 10px;
  padding: 0 7px;
}
code.fn {
  color: var(--magenta);
}
code.field {
  color: var(--gold);
}
.filter {
  width: min(420px, 100%);
  margin: 8px 0;
}
table.rules {
  border-collapse: collapse;
  width: 100%;
}
.rules th,
.rules td {
  text-align: left;
  vertical-align: top;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}
.rules tr {
  scroll-margin-top: 12px;
}
.sev.error {
  color: var(--error-text);
}
.sev.warning {
  color: var(--warning-text);
}
.sev.info {
  color: var(--info-text);
}
.sev.hint {
  color: var(--muted);
}
pre {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  overflow-x: auto;
}
pre code {
  background: none;
}
footer {
  margin-top: 48px;
  display: block;
  text-align: center;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.8;
}
/* One line of fine print that wraps like text; copying it gives one line too. */
footer > span {
  margin-inline: 0.6em;
}
footer a {
  color: var(--muted);
  text-decoration: none;
}
footer a:hover,
footer a:focus-visible {
  color: var(--text);
  text-decoration: underline;
}
footer a:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 2px;
  border-radius: 2px;
}
@media (max-width: 760px) {
  .docs-top {
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 6px;
    padding: 6px 10px;
  }
}
@media (max-width: 640px) {
  .docs-tagline {
    display: none;
  }
}
@media (max-width: 800px) {
  .docs {
    grid-template-columns: minmax(0, 1fr);
  }
  .toc {
    position: static;
    max-height: none;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 12px;
    padding: 16px 0 0;
  }
  .rules th:nth-child(2),
  .rules td:nth-child(2) {
    display: none;
  }
}
</style>
