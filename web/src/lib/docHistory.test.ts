import { describe, expect, it } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { history, redo, undo } from '@codemirror/commands'
import { originField, originHistory, replaceSpec, type Origin } from './docHistory'
import { RECIPES, showsDuration } from './recipes'

// An editor state with the playground's history setup, driven the way the commands drive a view.
function editor(doc = '', origin: Origin | null = null) {
  // Every step here runs well inside history's 500 ms grouping window, so typing would merge.
  let state = EditorState.create({ doc, extensions: [history(), originHistory(origin)] })
  const apply = (spec: TransactionSpec) => (state = state.update(spec).state)
  return {
    get doc() {
      return state.doc.toString()
    },
    get origin() {
      return state.field(originField)
    },
    replace(text: string, o?: Origin | null) {
      const spec = replaceSpec(state, text, o)
      if (spec) apply(spec)
      return spec
    },
    type(text: string) {
      const end = state.doc.length
      state = state.update({ changes: { from: end, insert: text }, selection: { anchor: end + text.length }, userEvent: 'input.type' }).state
    },
    undo: () => undo({ state, dispatch: (tr) => (state = tr.state) }),
    redo: () => redo({ state, dispatch: (tr) => (state = tr.state) }),
  }
}

const recipe = (title: string): Origin => {
  const r = RECIPES.find((x) => x.title === title)!
  return { label: r.title, text: r.format, recipe: r.title }
}

describe('replacing the whole format', () => {
  const a = recipe('WACUP default')
  const b = recipe('Numbered tracks')

  it('makes each replacement one undo step, back and forth', () => {
    const ed = editor('start')
    ed.replace(a.text, a)
    ed.replace(b.text, b)
    expect(ed.doc).toBe(b.text)
    expect(ed.undo()).toBe(true)
    expect([ed.doc, ed.origin]).toEqual([a.text, a])
    expect(ed.undo()).toBe(true)
    expect([ed.doc, ed.origin]).toEqual(['start', null])
    expect(ed.undo()).toBe(false)
    expect(ed.redo()).toBe(true)
    expect([ed.doc, ed.origin]).toEqual([a.text, a])
    expect(ed.redo()).toBe(true)
    expect([ed.doc, ed.origin]).toEqual([b.text, b])
  })

  it("doesn't merge with typing just before or just after", () => {
    const ed = editor('x')
    ed.type('y')
    ed.replace(a.text, a)
    ed.type('!')
    ed.type('?')
    expect(ed.doc).toBe(`${a.text}!?`)
    ed.undo() // the typing after (one group)
    expect(ed.doc).toBe(a.text)
    ed.undo() // the replacement
    expect(ed.doc).toBe('xy')
    expect(ed.origin).toBeNull()
  })

  it('keeps the origin through edits, and an undo of the edit keeps it too', () => {
    const ed = editor('', a)
    ed.type('z')
    expect(ed.origin).toBe(a)
    ed.undo()
    expect([ed.doc, ed.origin]).toEqual(['', a])
  })

  it('leaves the origin alone when none is given (a reset to the same base)', () => {
    const ed = editor('', a)
    ed.replace(a.text)
    ed.type('!')
    ed.replace(a.text)
    expect([ed.doc, ed.origin]).toEqual([a.text, a])
    ed.undo()
    expect(ed.doc).toBe(`${a.text}!`)
  })

  it('does nothing for the same text and origin, and keeps a same-text origin change out of the history', () => {
    const ed = editor(a.text, null)
    expect(ed.replace(a.text)).toBeNull()
    expect(ed.replace(a.text, null)).toBeNull()
    ed.replace(a.text, a)
    expect(ed.origin).toBe(a)
    expect(ed.undo()).toBe(false)
  })

  it('carries the duration rule: a ticker recipe hides the column until something else is loaded', () => {
    const active = (o: Origin | null) => RECIPES.find((r) => r.title === o?.recipe)
    const ticker = recipe('Custom songticker')
    const ed = editor('')
    ed.replace(ticker.text, ticker)
    expect(showsDuration(true, active(ed.origin))).toBe(false)
    ed.type(' x')
    expect(showsDuration(true, active(ed.origin))).toBe(false)
    ed.replace(a.text, a)
    expect(showsDuration(true, active(ed.origin))).toBe(true)
    ed.undo()
    expect(showsDuration(true, active(ed.origin))).toBe(false)
    ed.replace('saved', { label: 'My format', text: 'saved' })
    expect(showsDuration(true, active(ed.origin))).toBe(true)
  })
})
