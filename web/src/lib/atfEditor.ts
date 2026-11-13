import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, runScopeHandlers, highlightSpecialChars, highlightTrailingWhitespace, highlightWhitespace, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { history, historyKeymap, isolateHistory, redo, undo } from '@codemirror/commands'
import { setDiagnostics, type Action, type Diagnostic } from '@codemirror/lint'
import type { Finding } from '@/core'
import { docPos, docRange, toFormat, type FormatView } from './document'
import { EDITOR_LABEL, EDITOR_PLACEHOLDER, findingRange, highlightMarks } from './highlight'
import { atfKeymap } from './keymap'
import { NUL_RULE, nulOffsets } from './nulChar'
import { originField, originHistory, replaceSpec, type Origin } from './docHistory'

function buildHighlights(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const m of highlightMarks(state.doc.toString())) builder.add(m.from, m.to, Decoration.mark({ class: m.cls }))
  return builder.finish()
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildHighlights(view.state)
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = buildHighlights(update.state)
    }
  },
  { decorations: (v) => v.decorations },
)

/** A temporary highlight of one part of the format, driven from the parts table. */
const setFocus = StateEffect.define<{ from: number; to: number } | null>()
const focusField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFocus)) {
        return e.value && e.value.to > e.value.from
          ? Decoration.set([Decoration.mark({ class: 'atf-focus' }).range(e.value.from, e.value.to)])
          : Decoration.none
      }
    }
    return tr.docChanged ? value.map(tr.changes) : value
  },
  provide: (f) => EditorView.decorations.from(f),
})

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'var(--text)', fontSize: 'var(--editor-size)' },
    '.cm-content': { fontFamily: 'var(--mono)', padding: '14px 0', caretColor: 'var(--caret)' },
    '.cm-line': { padding: '0 18px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--caret)', borderLeftWidth: '2px' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
    '.cm-placeholder': { color: 'var(--muted)', fontStyle: 'italic' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
    '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' },
    '.cm-diagnostic': { fontFamily: 'var(--sans)', padding: '4px 8px' },
    // Squiggles and tooltip markers in the theme's severity colours (exact: they're marks, not
    // words), as wavy underlines so the colour can be a CSS variable.
    '.cm-lintRange': { backgroundImage: 'none', textDecorationLine: 'underline', textDecorationStyle: 'wavy', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
    '.cm-lintRange-error': { textDecorationColor: 'var(--error)' },
    '.cm-lintRange-warning': { textDecorationColor: 'var(--warning)' },
    '.cm-lintRange-info': { textDecorationColor: 'var(--info)' },
    '.cm-lintRange-hint': { textDecorationColor: 'var(--dim)' },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--error)' },
    '.cm-diagnostic-warning': { borderLeftColor: 'var(--warning)' },
    '.cm-diagnostic-info': { borderLeftColor: 'var(--info)' },
    '.cm-diagnostic-hint': { borderLeftColor: 'var(--dim)' },
  },
  { dark: true },
)

/** The NUL warning's quick fix: deletes every NUL in the document, as one undoable change. */
const removeNuls: Action = {
  name: 'Remove NUL characters',
  apply(view) {
    const changes = nulOffsets(view.state.doc.toString()).map((i) => ({ from: i, to: i + 1 }))
    if (changes.length) view.dispatch({ changes, userEvent: 'delete' })
  },
}

export interface AtfEditor {
  view: EditorView
  /** Replaces the whole document, as one undo step (see lib/docHistory.ts); with `origin`, sets that too. */
  setDoc(doc: string, origin?: Origin | null): void
  /** Steps back or forward through the history, as Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y do. */
  undo(): boolean
  redo(): boolean
  insert(text: string): void
  /** Select a range of the joined format string and scroll it into view. */
  selectFormatRange(start: number, end: number): void
  /** Highlight a range of the joined format string, or clear it with `null`. */
  focusFormatRange(range: { start: number; end: number } | null): void
  setFindings(findings: Finding[]): void
  /**
   * Replaces the document with an equivalent one (the same format, re-wrapped) as one undo step,
   * keeping the cursor on the same character of the format.
   */
  rewrap(next: string): void
  /** How many characters fit on one line of the editor. */
  charsPerLine(): number
  /** Show spaces (Settings): marks each space and tab, and spaces at the end of a line. */
  setShowSpaces(on: boolean): void
  // Input buffered by the static copy before the editor loaded (components/AtfEditor.vue), replayed
  // as the editor would have handled it.
  /** Selects document positions (clamped to the document). */
  setSelection(anchor: number, head: number): void
  /** Types or pastes text over the selection. */
  typeText(text: string, paste?: boolean): void
  /** Runs a key through the editor's key bindings (arrows, Backspace, Enter, Ctrl+Z…). */
  pressKey(init: KeyboardEventInit): boolean
  destroy(): void
}

/** The format offset of a document position: the first format character at or after it. */
function formatOffset(view: FormatView, pos: number): number {
  let lo = 0
  let hi = view.map.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((view.map[mid] ?? 0) < pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface EditorOptions {
  /** Shift+Alt+F, VS Code's Format Document. */
  onFormat?: () => void
  /** Where the starting document came from. */
  origin?: Origin | null
  /** Called when the origin changes: a replacement, or an undo or redo of one. */
  onOrigin?: (origin: Origin | null) => void
  /** Show spaces at the start (see setShowSpaces). */
  spaces?: boolean
}

export function createAtfEditor(parent: HTMLElement, doc: string, onChange: (doc: string) => void, options: EditorOptions = {}): AtfEditor {
  const formatKey = { key: 'Shift-Alt-f', preventDefault: true, run: () => (options.onFormat?.(), true) }
  // Show spaces switches live: the compartment's content is swapped, the editor stays.
  const spaces = new Compartment()
  const spaceMarks = (on: boolean): Extension => (on ? [highlightWhitespace(), highlightTrailingWhitespace()] : [])
  const extensions: Extension[] = [
    history(),
    originHistory(options.origin ?? null),
    keymap.of([formatKey, ...atfKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    // Control characters show as a red dot (a NUL is a warning too: see lib/nulChar.ts).
    highlightSpecialChars(),
    spaces.of(spaceMarks(!!options.spaces)),
    placeholder(EDITOR_PLACEHOLDER),
    highlighter,
    focusField,
    theme,
    EditorView.contentAttributes.of({ 'aria-label': EDITOR_LABEL, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString())
      const origin = u.state.field(originField)
      if (origin !== u.startState.field(originField)) options.onOrigin?.(origin)
    }),
  ]
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions }) })
  const formatView = () => toFormat(view.state.doc.toString())
  /** The horizontal padding of a line, in px (read on first use by charsPerLine). */
  let linePadding: number | undefined
  /** How many findings the editor shows (none yet: a first, empty set needs no dispatch). */
  let shownFindings = 0

  return {
    view,
    setDoc(next, origin) {
      const spec = replaceSpec(view.state, next, origin)
      if (spec) view.dispatch(spec)
    },
    undo: () => undo(view),
    redo: () => redo(view),
    insert(text) {
      const { from, to } = view.state.selection.main
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
      view.focus()
    },
    selectFormatRange(start, end) {
      const { from, to } = docRange(formatView(), start, end)
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
      view.focus()
    },
    focusFormatRange(range) {
      const r = range ? docRange(formatView(), range.start, range.end) : null
      view.dispatch({ effects: setFocus.of(r) })
    },
    setFindings(findings) {
      // Typing a valid format leaves no findings, keystroke after keystroke: then there's nothing to
      // dispatch, and CodeMirror is spared an update and its measure cycle.
      if (!findings.length && !shownFindings) return
      shownFindings = findings.length
      const fv = formatView()
      const len = view.state.doc.length
      const diagnostics: Diagnostic[] = findings.map((f) => ({
        ...findingRange(fv, len, f),
        severity: f.severity,
        message: f.message,
        source: f.rule,
        actions: (f.rule as string) === NUL_RULE ? [removeNuls] : undefined,
      }))
      view.dispatch(setDiagnostics(view.state, diagnostics))
    },
    rewrap(next) {
      const old = view.state.doc.toString()
      if (next === old) return
      const before = toFormat(old)
      const after = toFormat(next)
      const move = (pos: number) => Math.min(docPos(after, formatOffset(before, pos)), next.length)
      // Only the changed middle is replaced, so the edit (and its undo) stays small.
      let start = 0
      while (start < old.length && start < next.length && old[start] === next[start]) start++
      let end = 0
      while (end < old.length - start && end < next.length - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end++
      const { anchor, head } = view.state.selection.main
      view.dispatch({
        changes: { from: start, to: old.length - end, insert: next.slice(start, next.length - end) },
        selection: { anchor: move(anchor), head: move(head) },
        annotations: isolateHistory.of('full'),
        scrollIntoView: true,
        userEvent: 'format',
      })
    },
    charsPerLine() {
      // The line padding comes from the theme and never changes: read it once.
      if (linePadding === undefined) {
        const line = view.contentDOM.querySelector('.cm-line')
        const style = line ? getComputedStyle(line) : undefined
        if (style) linePadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      }
      return Math.floor((view.contentDOM.clientWidth - (linePadding ?? 36)) / view.defaultCharacterWidth)
    },
    setShowSpaces(on) {
      view.dispatch({ effects: spaces.reconfigure(spaceMarks(on)) })
    },
    setSelection(anchor, head) {
      const len = view.state.doc.length
      view.dispatch({ selection: { anchor: Math.min(anchor, len), head: Math.min(head, len) } })
    },
    typeText(text, paste) {
      view.dispatch({ ...view.state.replaceSelection(text), scrollIntoView: true, userEvent: paste ? 'input.paste' : 'input.type' })
    },
    pressKey: (init) => runScopeHandlers(view, new KeyboardEvent('keydown', init), 'editor'),
    destroy() {
      view.destroy()
    },
  }
}
