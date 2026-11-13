// The playground's action hash (#recipe=…, #saved=…, #ref=…): what a search result on the docs page
// asks the playground to do. Its own small module, so the page reads it at startup without loading
// the search (lib/search.ts, lazy since the palette is).

/** What the playground does for a result, also carried in its URL hash from the docs page. */
export type PlaygroundAction = { kind: 'recipe'; title: string } | { kind: 'saved'; id: string } | { kind: 'ref'; target: string }

/**
 * The playground's action hash. It never has an `f` key, so it can't be taken for a share link
 * (`#f=…&s=…`), and a share link never parses as an action.
 */
export function encodeAction(action: PlaygroundAction): string {
  const params = new URLSearchParams()
  if (action.kind === 'recipe') params.set('recipe', action.title)
  else if (action.kind === 'saved') params.set('saved', action.id)
  else params.set('ref', action.target)
  return '#' + params.toString()
}

export function parseAction(hash: string): PlaygroundAction | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  if (params.has('f')) return undefined
  const recipe = params.get('recipe')
  if (recipe) return { kind: 'recipe', title: recipe }
  const saved = params.get('saved')
  if (saved) return { kind: 'saved', id: saved }
  const ref = params.get('ref')
  if (ref && /^(fn|field)-./.test(ref)) return { kind: 'ref', target: ref }
  return undefined
}
