import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { deleteCharBackward as cmBackwardView, deleteCharForward as cmForwardView, history, undo } from '@codemirror/commands'
import { atfKeymap, deleteCharBackward, deleteCharForward, insertBlankLine } from './keymap'

/** A state with the cursor (or selection) marked by `|` (or `[`…`]`), with history. */
function at(marked: string, extra = {}) {
  const sel = marked.indexOf('[')
  if (sel >= 0) {
    const end = marked.indexOf(']') - 1
    const doc = marked.replace('[', '').replace(']', '')
    return EditorState.create({ doc, selection: EditorSelection.range(sel, end), extensions: [history()], ...extra })
  }
  const pos = marked.indexOf('|')
  return EditorState.create({ doc: marked.replace('|', ''), selection: { anchor: pos }, extensions: [history()], ...extra })
}
function run(cmd: StateCommand, state: EditorState): { state: EditorState; tr?: Transaction; ran: boolean } {
  let tr: Transaction | undefined
  const ran = cmd({ state, dispatch: (t) => (tr = t) })
  return { state: tr ? tr.state : state, tr, ran }
}
const show = (s: EditorState) => {
  const d = s.doc.toString()
  const { from, to } = s.selection.main
  return from === to ? d.slice(0, from) + '|' + d.slice(from) : d.slice(0, from) + '[' + d.slice(from, to) + ']' + d.slice(to)
}

// CodeMirror's versions are typed as view commands but only use `state` and `dispatch` here (no
// atomic ranges), so they run on a bare state too.
const cmBackward = cmBackwardView as unknown as StateCommand
const cmForward = cmForwardView as unknown as StateCommand

const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'
const THUMBS = '\u{1F44D}\u{1F3FD}'
const FLAG = '\u{1F1E6}\u{1F1FA}'
const HEART = '❤️'
const E_ACUTE = 'é'

describe('Backspace and Delete', () => {
  it.each([
    ['ab|c', 'a|c'],
    ['|abc', '|abc'],
    [`x${FAMILY}|y`, 'x|y'],
    [`x${FLAG}|y`, 'x|y'],
    [`x${HEART}|y`, 'x|y'],
    // Backward, a combining mark or a skin tone goes on its own (as in a browser's text fields and
    // CodeMirror), so an accent can be taken off; forward, the whole cluster goes.
    [`caf${E_ACUTE}|!`, 'cafe|!'],
    [`x${THUMBS}|y`, 'x\u{1F44D}|y'],
    ['ab\n|cd', 'ab|cd'],
    ['a[bc]d', 'a|d'],
  ])('Backspace %j → %j', (input, want) => {
    expect(show(run(deleteCharBackward, at(input)).state)).toBe(want)
  })
  it.each([
    ['a|bc', 'a|c'],
    ['abc|', 'abc|'],
    [`x|${FAMILY}y`, 'x|y'],
    [`x|${FLAG}y`, 'x|y'],
    [`x|${E_ACUTE}y`, 'x|y'],
    [`x|${THUMBS}y`, 'x|y'],
    ['ab|\ncd', 'ab|cd'],
    ['a[bc]d', 'a|d'],
  ])('Delete %j → %j', (input, want) => {
    expect(show(run(deleteCharForward, at(input)).state)).toBe(want)
  })

  it("does what CodeMirror's own commands do, transaction for transaction (outside leading whitespace)", () => {
    const docs = [`x${FAMILY}y`, `ab${E_ACUTE}c\nd${FLAG}e`, `${HEART}${THUMBS}\n\nz`, 'plain text']
    for (const doc of docs) {
      for (let pos = 0; pos <= doc.length; pos++) {
        for (const [ours, theirs] of [
          [deleteCharBackward, cmBackward],
          [deleteCharForward, cmForward],
        ] as const) {
          const state = EditorState.create({ doc, selection: { anchor: pos } })
          const a = run(ours, state)
          const b = run(theirs, state)
          expect(a.ran).toBe(b.ran)
          if (!a.tr || !b.tr) continue
          expect(a.state.doc.toString()).toBe(b.state.doc.toString())
          expect(a.state.selection.main.head).toBe(b.state.selection.main.head)
          for (const ev of ['delete.backward', 'delete.forward', 'delete.selection']) expect(a.tr.isUserEvent(ev)).toBe(b.tr.isUserEvent(ev))
        }
      }
    }
  })

  it('labels its transactions like CodeMirror: delete.backward, delete.forward, delete.selection', () => {
    expect(run(deleteCharBackward, at('ab|')).tr!.isUserEvent('delete.backward')).toBe(true)
    expect(run(deleteCharForward, at('|ab')).tr!.isUserEvent('delete.forward')).toBe(true)
    expect(run(deleteCharBackward, at('[ab]')).tr!.isUserEvent('delete.selection')).toBe(true)
  })

  it("groups in the undo history exactly as CodeMirror's commands do", () => {
    const steps = (backward: StateCommand, forward: StateCommand) => {
      let state = at('|')
      const apply = (tr: Transaction) => (state = tr.state)
      apply(state.update({ changes: { from: 0, insert: 'hello world' }, selection: { anchor: 11 }, userEvent: 'input.type' }))
      for (let i = 0; i < 3; i++) apply(run(backward, state).tr!)
      apply(state.update({ selection: { anchor: 2 } }))
      for (let i = 0; i < 2; i++) apply(run(forward, state).tr!)
      apply(state.update({ selection: { anchor: 0, head: 3 } }))
      apply(run(backward, state).tr!)
      const out = [state.doc.toString()]
      while (undo({ state, dispatch: apply })) out.push(state.doc.toString())
      return out
    }
    const ours = steps(deleteCharBackward, deleteCharForward)
    expect(ours).toEqual(steps(cmBackward, cmForward))
    expect(ours[0]).toBe(' wo')
  })

  it('does nothing in a read-only editor', () => {
    expect(run(deleteCharBackward, at('ab|', { extensions: [EditorState.readOnly.of(true)] })).ran).toBe(false)
  })
})

describe('Ctrl+Enter', () => {
  it('opens an empty line below, without indentation', () => {
    expect(show(run(insertBlankLine, at('  a|b\nc')).state)).toBe('  ab\n|\nc')
  })
})

describe('the key map', () => {
  const keys = new Set(atfKeymap.flatMap((b) => [b.key, b.mac].filter(Boolean)))
  it('keeps the editing keys', () => {
    for (const k of ['Backspace', 'Delete', 'Enter', 'Mod-Backspace', 'Mod-Delete', 'Alt-ArrowUp', 'Alt-ArrowDown', 'Shift-Alt-ArrowUp', 'Shift-Mod-k', 'Mod-a', 'Escape', 'PageUp', 'Home', 'End', 'Mod-Enter', 'Cmd-ArrowLeft', 'Ctrl-h'])
      expect(keys.has(k), k).toBe(true)
  })
  it('leaves out the language-only commands', () => {
    for (const k of ['Mod-/', 'Mod-[', 'Mod-]', 'Mod-i', 'Shift-Mod-\\', 'Mod-Alt-\\', 'Alt-A', 'Ctrl-m']) expect(keys.has(k), k).toBe(false)
    // Alt+Left/Right (the syntax moves) are gone; on macOS Alt+Left/Right stay the word moves.
    expect(atfKeymap.some((b) => b.key === 'Alt-ArrowLeft' || b.key === 'Alt-ArrowRight')).toBe(false)
  })
})
