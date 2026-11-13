import { EditorSelection, findClusterBreak, type StateCommand } from '@codemirror/state'
import { EditorView, type KeyBinding } from '@codemirror/view'
import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  copyLineUp,
  cursorCharLeft,
  cursorCharRight,
  cursorDocEnd,
  cursorDocStart,
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  cursorLineBoundaryLeft,
  cursorLineBoundaryRight,
  cursorLineDown,
  cursorLineEnd,
  cursorLineStart,
  cursorLineUp,
  cursorPageDown,
  cursorPageUp,
  deleteGroupBackward,
  deleteGroupForward,
  deleteLine,
  deleteLineBoundaryBackward,
  deleteLineBoundaryForward,
  deleteToLineEnd,
  insertNewline,
  moveLineDown,
  moveLineUp,
  selectAll,
  selectCharLeft,
  selectCharRight,
  selectDocEnd,
  selectDocStart,
  selectGroupLeft,
  selectGroupRight,
  selectLine,
  selectLineBoundaryBackward,
  selectLineBoundaryForward,
  selectLineBoundaryLeft,
  selectLineBoundaryRight,
  selectLineDown,
  selectLineEnd,
  selectLineStart,
  selectLineUp,
  selectPageDown,
  selectPageUp,
  simplifySelection,
  splitLine,
  transposeChars,
} from '@codemirror/commands'

/**
 * The editor's keys: CodeMirror's `defaultKeymap` and `standardKeymap` (from @codemirror/commands,
 * MIT licence, copyright Marijn Haverbeke and others; see public/third-party-notices.txt), less what only
 * makes sense with a language package: the syntax moves (cursorSyntax*, selectParentSyntax,
 * cursorMatchingBracket), indentation (indentMore, indentLess, indentSelection,
 * insertNewlineAndIndent), comment toggles, and the Tab focus-mode switch (Tab isn't bound). Enter
 * is a plain `insertNewline`; Ctrl+Enter, Backspace and Delete are the commands below. Those are why:
 * CodeMirror's versions import @codemirror/language (for indentation), which brings it and
 * @lezer/* into the bundle for a format with no indentation at all.
 */

/**
 * Backspace and Delete: a non-empty selection is deleted; otherwise the grapheme cluster before
 * (or after) the cursor goes, so an emoji, a ZWJ sequence or a letter with combining accents goes
 * whole; at the start (end) of a line, the line joins the one before (after). The same
 * transactions as CodeMirror's deleteCharBackward/Forward (user events `delete.backward`,
 * `delete.forward`, `delete.selection`, so typing and deleting group in the history the same way),
 * without its "delete one indent unit in leading whitespace" step and atomic ranges (none here).
 */
function deleteChar(forward: boolean): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false
    let event = 'delete.selection'
    const changes = state.changeByRange((range) => {
      let { from, to } = range
      if (from === to) {
        const line = state.doc.lineAt(from)
        let target = findClusterBreak(line.text, from - line.from, forward, forward) + line.from
        if (target === from && line.number !== (forward ? state.doc.lines : 1)) target += forward ? 1 : -1
        // A variation selector left before the cursor goes with the character it belongs to.
        else if (!forward && /[︀-️]/.test(line.text.slice(target - line.from, from - line.from)))
          target = findClusterBreak(line.text, target - line.from, false, false) + line.from
        if (target < from) event = 'delete.backward'
        else if (target > from) event = 'delete.forward'
        from = Math.min(from, target)
        to = Math.max(to, target)
      }
      return from === to ? { range } : { changes: { from, to }, range: EditorSelection.cursor(from, from < range.head ? -1 : 1) }
    })
    if (changes.changes.empty) return false
    dispatch(
      state.update(changes, {
        scrollIntoView: true,
        userEvent: event,
        effects: event === 'delete.selection' ? EditorView.announce.of(state.phrase('Selection deleted')) : undefined,
      }),
    )
    return true
  }
}

/** Ctrl+Enter (Cmd+Enter): a new empty line below the current one, cursor on it (CodeMirror's insertBlankLine, unindented). */
export const insertBlankLine: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from)
    const at = (range.to <= line.to ? line : state.doc.lineAt(range.to)).to
    return { changes: { from: at, insert: state.lineBreak }, range: EditorSelection.cursor(at + state.lineBreak.length) }
  })
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

export const deleteCharBackward = deleteChar(false)
export const deleteCharForward = deleteChar(true)

/** Emacs-style keys, bound on macOS only (as in CodeMirror's standardKeymap). */
const emacsStyle: KeyBinding[] = [
  { key: 'Ctrl-b', run: cursorCharLeft, shift: selectCharLeft, preventDefault: true },
  { key: 'Ctrl-f', run: cursorCharRight, shift: selectCharRight },
  { key: 'Ctrl-p', run: cursorLineUp, shift: selectLineUp },
  { key: 'Ctrl-n', run: cursorLineDown, shift: selectLineDown },
  { key: 'Ctrl-a', run: cursorLineStart, shift: selectLineStart },
  { key: 'Ctrl-e', run: cursorLineEnd, shift: selectLineEnd },
  { key: 'Ctrl-d', run: deleteCharForward },
  { key: 'Ctrl-h', run: deleteCharBackward },
  { key: 'Ctrl-k', run: deleteToLineEnd },
  { key: 'Ctrl-Alt-h', run: deleteGroupBackward },
  { key: 'Ctrl-o', run: splitLine },
  { key: 'Ctrl-t', run: transposeChars },
  { key: 'Ctrl-v', run: cursorPageDown },
]

const standard: KeyBinding[] = [
  { key: 'ArrowLeft', run: cursorCharLeft, shift: selectCharLeft, preventDefault: true },
  { key: 'Mod-ArrowLeft', mac: 'Alt-ArrowLeft', run: cursorGroupLeft, shift: selectGroupLeft, preventDefault: true },
  { mac: 'Cmd-ArrowLeft', run: cursorLineBoundaryLeft, shift: selectLineBoundaryLeft, preventDefault: true },
  { key: 'ArrowRight', run: cursorCharRight, shift: selectCharRight, preventDefault: true },
  { key: 'Mod-ArrowRight', mac: 'Alt-ArrowRight', run: cursorGroupRight, shift: selectGroupRight, preventDefault: true },
  { mac: 'Cmd-ArrowRight', run: cursorLineBoundaryRight, shift: selectLineBoundaryRight, preventDefault: true },
  { key: 'ArrowUp', run: cursorLineUp, shift: selectLineUp, preventDefault: true },
  { mac: 'Cmd-ArrowUp', run: cursorDocStart, shift: selectDocStart },
  { mac: 'Ctrl-ArrowUp', run: cursorPageUp, shift: selectPageUp },
  { key: 'ArrowDown', run: cursorLineDown, shift: selectLineDown, preventDefault: true },
  { mac: 'Cmd-ArrowDown', run: cursorDocEnd, shift: selectDocEnd },
  { mac: 'Ctrl-ArrowDown', run: cursorPageDown, shift: selectPageDown },
  { key: 'PageUp', run: cursorPageUp, shift: selectPageUp },
  { key: 'PageDown', run: cursorPageDown, shift: selectPageDown },
  { key: 'Home', run: cursorLineBoundaryBackward, shift: selectLineBoundaryBackward, preventDefault: true },
  { key: 'Mod-Home', run: cursorDocStart, shift: selectDocStart },
  { key: 'End', run: cursorLineBoundaryForward, shift: selectLineBoundaryForward, preventDefault: true },
  { key: 'Mod-End', run: cursorDocEnd, shift: selectDocEnd },
  { key: 'Enter', run: insertNewline, shift: insertNewline },
  { key: 'Mod-a', run: selectAll },
  { key: 'Backspace', run: deleteCharBackward, shift: deleteCharBackward, preventDefault: true },
  { key: 'Delete', run: deleteCharForward, preventDefault: true },
  { key: 'Mod-Backspace', mac: 'Alt-Backspace', run: deleteGroupBackward, preventDefault: true },
  { key: 'Mod-Delete', mac: 'Alt-Delete', run: deleteGroupForward, preventDefault: true },
  { mac: 'Mod-Backspace', run: deleteLineBoundaryBackward, preventDefault: true },
  { mac: 'Mod-Delete', run: deleteLineBoundaryForward, preventDefault: true },
  ...emacsStyle.map((b) => ({ mac: b.key, run: b.run, shift: b.shift })),
]

/** Line moves and copies, extra cursors, Escape, blank line, select line, delete line; then the standard keys. */
export const atfKeymap: readonly KeyBinding[] = [
  { key: 'Alt-ArrowUp', run: moveLineUp },
  { key: 'Shift-Alt-ArrowUp', run: copyLineUp },
  { key: 'Alt-ArrowDown', run: moveLineDown },
  { key: 'Shift-Alt-ArrowDown', run: copyLineDown },
  { key: 'Mod-Alt-ArrowUp', run: addCursorAbove },
  { key: 'Mod-Alt-ArrowDown', run: addCursorBelow },
  { key: 'Escape', run: simplifySelection },
  { key: 'Mod-Enter', run: insertBlankLine },
  { key: 'Alt-l', mac: 'Ctrl-l', run: selectLine },
  { key: 'Shift-Mod-k', run: deleteLine },
  ...standard,
]
