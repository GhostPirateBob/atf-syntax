<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AtfEditor } from '@/lib/atfEditor'
import type { Origin } from '@/lib/docHistory'
import type { Finding } from '@/core'
import { toFormat } from '@/lib/document'
import { EDITOR_LABEL, EDITOR_PLACEHOLDER, findingRange, staticLines } from '@/lib/highlight'
import { loadEditor } from '@/lib/editorLoader'
import { yieldToMain } from '@/lib/timing'

/** `origin` is read once, at mount; after that the editor owns it (it follows undo and redo). */
const props = defineProps<{ doc: string; findings: Finding[]; origin?: Origin | null; spaces?: boolean }>()
const emit = defineEmits<{ 'update:doc': [doc: string]; 'update:origin': [origin: Origin | null]; format: [] }>()

const host = ref<HTMLDivElement>()
let editor: AtfEditor | undefined
let unmounted = false

// ---- before CodeMirror loads ----------------------------------------------------------------------
// The editor module (CodeMirror) loads after the first paint (main.ts starts the download). Until
// then the format shows as static text styled exactly like the editor, so the swap moves nothing.
// It is focusable and labelled like the editor; keys typed into it, a paste, and where it was
// clicked are kept and replayed into the editor once it's up. What the page does to the editor
// meanwhile (a recipe, a reset, format, undo) shows at once and is replayed too, so the editor's
// history ends up the same as if it had been there all along.
const ready = ref(false)
const content = ref<HTMLDivElement>()
const staticRoot = ref<HTMLDivElement>()
type Pending =
  | { kind: 'replace'; text: string; origin?: Origin | null }
  | { kind: 'rewrap'; text: string }
  | { kind: 'insert'; text: string }
  | { kind: 'undo' | 'redo' }
  | { kind: 'select'; start: number; end: number }
  | { kind: 'selection'; anchor: number; head: number }
  | { kind: 'text'; text: string; paste?: boolean }
  | { kind: 'key'; init: KeyboardEventInit }
const pending: Pending[] = []
const startDoc = props.doc
const startOrigin = props.origin ?? null
/** The document and origin as the editor will have them once the replacements so far are replayed. */
let current = props.doc
let origin = startOrigin
/** Replacements made before the editor loaded, so Ctrl+Z works on them before it too. */
const undone: { doc: string; origin: Origin | null }[] = []
const redone: { doc: string; origin: Origin | null }[] = []
let focusRange: { start: number; end: number } | null = null
let wantFocus = false

function show(doc: string, o: Origin | null) {
  if (o !== origin) emit('update:origin', (origin = o))
  if (doc !== current) emit('update:doc', (current = doc))
}
/** A whole new document (lib/docHistory.ts replaceSpec): an undo step unless only the origin changes. */
function preReplace(text: string, o?: Origin | null) {
  const same = text === current
  const newOrigin = o !== undefined && o !== origin
  if (same && !newOrigin) return
  if (!same) {
    undone.push({ doc: current, origin })
    redone.length = 0
  }
  pending.push({ kind: 'replace', text, origin: o })
  show(text, newOrigin ? o! : origin)
}
function preStep(text: string, op: Pending) {
  if (text === current) return
  undone.push({ doc: current, origin })
  redone.length = 0
  pending.push(op)
  show(text, origin)
}
function preHistory(kind: 'undo' | 'redo'): boolean {
  const [from, to] = kind === 'undo' ? [undone, redone] : [redone, undone]
  const step = from.pop()
  if (!step && !pending.some((p) => p.kind === 'text' || p.kind === 'key')) return false
  pending.push({ kind })
  if (step) {
    to.push({ doc: current, origin })
    show(step.doc, step.origin)
  }
  return true
}

/** The static copy's lines, with the editor's squiggles. */
const lines = computed(() => {
  if (ready.value) return []
  const fv = toFormat(props.doc)
  const squiggles = props.findings.map((f) => ({ ...findingRange(fv, props.doc.length, f), severity: f.severity }))
  return staticLines(props.doc, { spaces: props.spaces, squiggles }).map((l, i, all) => ({ ...l, to: (all[i + 1]?.from ?? props.doc.length + 1) - 1 }))
})

/** A DOM position in the static copy as a document offset. */
function offsetAt(node: Node, offset: number): number | undefined {
  const root = content.value
  if (!root?.contains(node)) return undefined
  let line: Node | null = node
  while (line && !(line instanceof HTMLElement && line.dataset.from !== undefined)) line = line.parentNode
  if (!(line instanceof HTMLElement)) {
    const all = root.querySelectorAll<HTMLElement>('[data-from]')
    return offset < all.length ? Number(all[offset]!.dataset.from) : props.doc.length
  }
  const r = document.createRange()
  r.setStart(line, 0)
  r.setEnd(node, offset)
  return Math.min(Number(line.dataset.from) + (line.dataset.empty ? 0 : r.toString().length), Number(line.dataset.to))
}
function staticSelection(): { anchor: number; head: number } | undefined {
  const sel = getSelection()
  if (!sel?.anchorNode || !sel.focusNode) return undefined
  const anchor = offsetAt(sel.anchorNode, sel.anchorOffset)
  const head = offsetAt(sel.focusNode, sel.focusOffset)
  return anchor === undefined || head === undefined ? undefined : { anchor, head }
}
/** Notes where the selection is, if it moved since the last note, before a buffered key. */
let noted: string | undefined
function noteSelection() {
  const s = staticSelection()
  if (!s || `${s.anchor}:${s.head}` === noted) return
  noted = `${s.anchor}:${s.head}`
  pending.push({ kind: 'selection', ...s })
}

/** Keys the editor binds (with any modifiers): kept for it, not left to scroll the page. */
const EDIT_KEYS = new Set(['Backspace', 'Delete', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
function onStaticKey(e: KeyboardEvent) {
  if (e.isComposing || e.key === 'Process' || e.key === 'Unidentified') return
  const mod = e.ctrlKey || e.metaKey
  // AltGr arrives as Ctrl+Alt on Windows; Ctrl+Z / Ctrl+Y are left to the page's undo handler.
  const typed = [...e.key].length === 1 && (!mod || (e.ctrlKey && e.altKey))
  const key = e.key.toLowerCase()
  const bound = EDIT_KEYS.has(e.key) || (mod && !e.altKey && (key === 'a' || (key === 'k' && e.shiftKey)))
  if (!typed && !bound) return
  e.preventDefault()
  e.stopPropagation()
  noteSelection()
  if (typed) pending.push({ kind: 'text', text: e.key })
  else pending.push({ kind: 'key', init: { key: e.key, code: e.code, keyCode: e.keyCode, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey } })
}
function onStaticPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain')
  if (!text) return
  e.preventDefault()
  noteSelection()
  pending.push({ kind: 'text', text, paste: true })
}
/** How many characters fit on a line, measured as CodeMirror does (a 27-character sample). */
function staticCharsPerLine(): number {
  const el = content.value
  const line = el?.querySelector('[data-from]')
  if (!el || !line) return 0
  const probe = document.createElement('span')
  probe.textContent = 'abc def ghi jkl mno pqr stu'
  line.appendChild(probe)
  const width = probe.getBoundingClientRect().width / 27
  probe.remove()
  return width ? Math.floor((el.clientWidth - 36) / width) : 0
}

// ---- the editor -----------------------------------------------------------------------------------
async function start() {
  let lib: typeof import('@/lib/atfEditor')
  try {
    lib = await loadEditor()
  } catch {
    // Offline or a failed fetch: the static copy stays; try again shortly.
    if (!unmounted) setTimeout(() => void start(), 3000)
    return
  }
  // Three short tasks rather than one long one: the module has just run; the editor is built in the
  // next task, off the page; it takes the static copy's place in the one after.
  await yieldToMain()
  if (unmounted || !host.value) return
  const ed = lib.createAtfEditor(document.createElement('div'), startDoc, (doc) => emit('update:doc', (current = doc)), {
    onFormat: () => emit('format'),
    origin: startOrigin,
    onOrigin: (o) => emit('update:origin', (origin = o)),
    spaces: props.spaces,
  })
  await yieldToMain()
  if (unmounted || !host.value) return ed.destroy()
  const hadFocus = !!content.value && document.activeElement === content.value
  noteSelection()
  for (const op of pending.splice(0)) {
    if (op.kind === 'replace') ed.setDoc(op.text, op.origin)
    else if (op.kind === 'rewrap') ed.rewrap(op.text)
    else if (op.kind === 'insert') ed.insert(op.text)
    else if (op.kind === 'undo') ed.undo()
    else if (op.kind === 'redo') ed.redo()
    else if (op.kind === 'select') ed.selectFormatRange(op.start, op.end)
    else if (op.kind === 'selection') ed.setSelection(op.anchor, op.head)
    else if (op.kind === 'text') ed.typeText(op.text, op.paste)
    else if (op.kind === 'key') ed.pressKey(op.init)
  }
  ed.setFindings(props.findings)
  if (focusRange) ed.focusFormatRange(focusRange)
  host.value.appendChild(ed.view.dom)
  editor = ed
  // Focus moves to the editor while the static copy is still there; then the copy is hidden at once
  // and Vue removes it on its next flush, in the same task: no frame shows both, or neither. (Not
  // removed by hand: Vue finds the container to patch through the old element's parent.)
  if (hadFocus || wantFocus) ed.view.focus()
  if (staticRoot.value) staticRoot.value.style.display = 'none'
  ready.value = true
  performance.mark('atf-editor-ready')
}
onMounted(() => {
  // After the first paint: one frame, then a yield (the sidebar's lists do the same).
  requestAnimationFrame(() => void yieldToMain().then(start))
})
onBeforeUnmount(() => {
  unmounted = true
  editor?.destroy()
})

watch(
  () => props.doc,
  (doc) => (editor ? editor.setDoc(doc) : (current = doc)),
)
watch(
  () => props.findings,
  (findings) => editor?.setFindings(findings),
)
watch(
  () => !!props.spaces,
  (on) => editor?.setShowSpaces(on),
)

defineExpose({
  /** Replaces the whole format as one undo step, optionally with where it came from. */
  replace: (text: string, o?: Origin | null) => (editor ? editor.setDoc(text, o) : preReplace(text, o)),
  undo: () => (editor ? editor.undo() : preHistory('undo')),
  redo: () => (editor ? editor.redo() : preHistory('redo')),
  insert(text: string) {
    if (editor) return editor.insert(text)
    const sel = staticSelection() ?? { anchor: current.length, head: current.length }
    const from = Math.min(sel.anchor, sel.head)
    pending.push({ kind: 'selection', ...sel })
    wantFocus = true
    preStep(current.slice(0, from) + text + current.slice(Math.max(sel.anchor, sel.head)), { kind: 'insert', text })
  },
  select(start: number, end: number) {
    if (editor) return editor.selectFormatRange(start, end)
    pending.push({ kind: 'select', start, end })
    wantFocus = true
  },
  focusRange: (range: { start: number; end: number } | null) => (editor ? editor.focusFormatRange(range) : (focusRange = range)),
  focus: () => (editor ? editor.view.focus() : content.value?.focus()),
  rewrap: (next: string) => (editor ? editor.rewrap(next) : preStep(next, { kind: 'rewrap', text: next })),
  charsPerLine: () => (editor ? editor.charsPerLine() : staticCharsPerLine()),
})
</script>

<template>
  <div ref="host" class="atf-editor">
    <div v-if="!ready" ref="staticRoot" class="atf-static">
      <div class="atf-static-scroller">
        <div
          ref="content"
          class="atf-static-content"
          role="textbox"
          aria-multiline="true"
          aria-readonly="true"
          :aria-label="EDITOR_LABEL"
          tabindex="0"
          @keydown="onStaticKey"
          @paste="onStaticPaste"
        >
          <div v-for="line in lines" :key="line.from" class="atf-static-line" :data-from="line.from" :data-to="line.to" :data-empty="doc ? undefined : ''">
            <template v-if="line.groups.length">
              <span v-for="(g, j) in line.groups" :key="j" :class="g.cls || undefined"><span v-for="(p, k) in g.pieces" :key="k" :class="p.cls || undefined">{{ p.text }}</span></span>
            </template>
            <span v-else-if="!doc" class="ph">{{ EDITOR_PLACEHOLDER }}</span>
            <br v-else />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.atf-editor {
  min-height: 3.2em;
}
/* The static copy, property for property CodeMirror's base theme plus ours (lib/atfEditor.ts):
   .atf-static is .cm-editor, then .cm-scroller, .cm-content (with .cm-lineWrapping) and .cm-line. */
.atf-static {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background-color: transparent;
  color: var(--text);
  font-size: var(--editor-size);
}
.atf-static-scroller {
  display: flex;
  align-items: flex-start;
  font-family: monospace;
  line-height: 1.4;
  height: 100%;
  overflow-x: auto;
  position: relative;
  z-index: 0;
  overflow-anchor: none;
}
.atf-static-content {
  margin: 0;
  flex-grow: 2;
  flex-shrink: 1;
  display: block;
  white-space: break-spaces;
  word-break: break-word;
  overflow-wrap: anywhere;
  box-sizing: border-box;
  min-height: 100%;
  padding: 14px 0;
  outline: none;
  font-family: var(--mono);
  caret-color: var(--caret);
  tab-size: 4;
  cursor: text;
}
.atf-static-content ::selection {
  background-color: var(--selection);
}
.atf-static-line {
  display: block;
  padding: 0 18px;
}
.ph {
  display: inline-block;
  vertical-align: top;
  user-select: none;
  color: var(--muted);
  font-style: italic;
}
.special {
  color: #f78;
}
.squiggle {
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}
.squiggle-error {
  text-decoration-color: var(--error);
}
.squiggle-warning {
  text-decoration-color: var(--warning);
}
.squiggle-info {
  text-decoration-color: var(--info);
}
.squiggle-hint {
  text-decoration-color: var(--dim);
}
/* Show spaces: the editor's .cm-space and .cm-space-other marks, and CodeMirror's trailing-space one. */
.space,
.space-other {
  outline: 1px dashed #586e75;
  outline-offset: -1px;
}
.trailing-space {
  background-color: #ff332255;
}
</style>
