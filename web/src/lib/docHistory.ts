import { StateEffect, StateField, Transaction, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state'
import { invertedEffects, isolateHistory } from '@codemirror/commands'

/**
 * Where the editor's format came from: what Reset goes back to, and (for a recipe) what the
 * duration column checks. It lives in the editor state and changes with each replacement, and
 * undo and redo restore it with the text, so Ctrl+Z after loading recipe B puts back recipe A and
 * its origin. Edits leave it alone.
 */
export interface Origin {
  /** Named in the toasts: "Reset to …". */
  label: string
  /** The text as it was loaded. */
  text: string
  /** The recipe's title, when it came from one. */
  recipe?: string
}

const setOrigin = StateEffect.define<Origin | null>()

export const originField = StateField.define<Origin | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setOrigin)) value = e.value
    return value
  },
})

/** The origin field, starting at `initial`, with its changes recorded in the undo history. */
export function originHistory(initial: Origin | null): Extension {
  return [
    originField.init(() => initial),
    invertedEffects.of((tr) => (tr.effects.some((e) => e.is(setOrigin)) ? [setOrigin.of(tr.startState.field(originField))] : [])),
  ]
}

/**
 * The transaction that replaces the whole document (a recipe, a saved format, an opened file, a
 * reset): one undo step of its own, never merged with typing just before or after it. With
 * `origin`, the origin changes too (undoably); leave it out to keep the current one. Null when
 * nothing would change. Same text with a new origin changes the origin outside the history, so
 * Ctrl+Z never lands on a step that changes nothing visible.
 */
export function replaceSpec(state: EditorState, text: string, origin?: Origin | null): TransactionSpec | null {
  const same = text === state.doc.toString()
  const newOrigin = origin !== undefined && origin !== state.field(originField)
  if (same && !newOrigin) return null
  return {
    changes: same ? undefined : { from: 0, to: state.doc.length, insert: text },
    effects: newOrigin ? setOrigin.of(origin) : undefined,
    annotations: same ? Transaction.addToHistory.of(false) : isolateHistory.of('full'),
    userEvent: 'input.replace',
  }
}
