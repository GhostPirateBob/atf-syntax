/** What the preview shows in place of a track's title when it has none to show (by row state). */
export const ROW_STATE_TEXT: Partial<Record<string, string>> = {
  freeze: '⚠ This would freeze WACUP',
  heavy: 'Too heavy to preview',
  timeout: "⚠ Didn't finish",
}

/** How many rows the hero playlist shows: two before the current track, it, and two after. */
export const PREVIEW_ROWS = 5

/**
 * The rows of the hero playlist around track `selected` of `count`: each row's offset from the
 * current track and the track it shows, wrapping at both ends like the playlist does. With fewer
 * tracks than `rows`, only as many rows as there are tracks, so no track shows twice; an even
 * count puts the extra row after the current one.
 */
export function previewWindow(count: number, selected: number, rows = PREVIEW_ROWS): { offset: number; index: number }[] {
  const shown = Math.min(rows, count)
  const first = -Math.floor((shown - 1) / 2)
  return Array.from({ length: shown }, (_, k) => {
    const offset = first + k
    return { offset, index: (((selected + offset) % count) + count) % count }
  })
}
