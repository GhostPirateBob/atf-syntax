/**
 * Starting points: WACUP's own defaults, custom recipes, recipes for patchy tags or bare file
 * names, and a showcase. Click one and see which suits your own tracks.
 */
export interface Recipe {
  title: string
  group: RecipeGroup
  note: string
  format: string
  /**
   * A song ticker format: while it's loaded the preview becomes a song ticker (one scrolling line,
   * see components/SongTicker.vue). It ends in %length% itself, as the ticker has no duration column.
   */
  ticker?: true
}

/** The Recipes tab's groups, in the order it shows them. */
export const RECIPE_GROUPS = ['WACUP defaults', 'Custom recipes', 'Song tickers', 'Patchy tags', 'Only filenames', 'Showcase'] as const
export type RecipeGroup = (typeof RECIPE_GROUPS)[number]

/** The recipes by group, in RECIPE_GROUPS order (each group's recipes in list order); empty groups left out. */
export function recipeGroups<R extends { group: RecipeGroup }>(recipes: readonly R[]): [RecipeGroup, R[]][] {
  return RECIPE_GROUPS.map((g) => [g, recipes.filter((r) => r.group === g)] as [RecipeGroup, R[]]).filter(([, list]) => list.length > 0)
}

export const RECIPES: Recipe[] = [
  {
    title: 'WACUP default',
    group: 'WACUP defaults',
    note: 'Artist only if there is one; the file name if there is no title.',
    format: '[%artist% - ]$if2(%title%,$filepart(%filename%))',
  },
  {
    title: 'Taskbar thumbnail',
    group: 'WACUP defaults',
    note: "gen_win10shell's taskbar format on one line, minus its $crlf() breaks and rating spaces.",
    format: "$if2(%title%,$filepart(%filename%))$if(%artist%, ,)%artist%[$if(%rating%,$rating(%filename%),)]$if(%album%, ,)%album%[$if(%year%,' ('%year%')',)]",
  },
  {
    title: 'Album artist first',
    group: 'Custom recipes',
    note: 'Album artist stays the same across an album, so the column does not jump on "feat." tracks.',
    format: '[$if2(%albumartist%,%artist%) - ]%title%',
  },
  {
    title: 'Numbered tracks',
    group: 'Custom recipes',
    note: 'Two-digit track numbers, dropped when a track has none.',
    format: '[$num(%tracknumber%,2). ][%artist% - ]%title%',
  },
  {
    title: 'Long albums to initials',
    group: 'Custom recipes',
    note: 'Shortens each part by its own length, not the whole line, so columns line up on every row.',
    format: '[$abbr(%artist%,20) ▸ ][$abbr(%album%,24) ▹ ]%title%',
  },
  {
    title: 'Cut long titles',
    group: 'Custom recipes',
    note: 'Keep the readable start of a long title instead of turning it into initials.',
    format: '[%artist% - ]$iflonger(%title%,30,$left(%title%,29)…,%title%)',
  },
  {
    title: "WACUP's default song ticker",
    group: 'Song tickers',
    note: 'For Taskbar Text, where %playlist_position% works: number, artist (SPC: album), title, length.',
    format: "%playlist_position%. [$ifstrequal2($fileext(%filename%),SPC,%album%,%artist%) - ]$if2(%title%,$filepart(%filename%)) '('%length%')'",
    ticker: true,
  },
  {
    title: 'Custom songticker',
    group: 'Song tickers',
    note: 'The WACUP default with the length on the end, so the ticker shows how long the song is.',
    format: '[%artist% - ]$if2(%title%,$filepart(%filename%)) %length%',
    ticker: true,
  },
  {
    title: 'Fall back to folder names',
    group: 'Patchy tags',
    note: 'For Artist\\Album\\file layouts: any missing tag comes from the folders instead.',
    format: '$if2(%artist%,$directory(%filename%,2)) - $if2(%album%,$directory(%filename%)) - $if2(%title%,$filepart(%filename%))',
  },
  {
    title: 'Split "Artist - Title" file names',
    group: 'Only filenames',
    note: 'Finds the first " - " in the file name. A file name without one is shown whole.',
    format: '$puts(f,$filepart(%filename%))$puts(p,$strstr($get(f), - ))$ifgreater($get(p),0,$left($get(f),$sub($get(p),1)) ▸ $right($get(f),$sub($len($get(f)),$add($get(p),2))),$get(f))',
  },
  {
    title: 'Abbreviated columns',
    group: 'Showcase',
    note: 'Artist, album and title in abbreviated columns. Strips "feat."/"ft" from the artist and cuts long titles.',
    format: "⇢   $puts(t,$if2(%title%,$filepart(%filename%)))$puts(araw,$if2(%albumartist%,%artist%))$puts(fp,$strstr($replace($replace($lower($get(araw)),'(',' '),' ft',' feat'),' feat'))$puts(a,$trim($ifgreater($get(fp),0,$left($get(araw),$sub($get(fp),1)),$get(araw))))$if($get(a),$abbr($get(a),20) ▸ ,)[$abbr(%album%,18) ▹ ]$iflonger($get(t),30,$left($get(t),29)…,$get(t))",
  },
]

/**
 * The duration column shows when the setting is on, except while a song ticker recipe is the
 * format's origin (see lib/docHistory.ts: loading a recipe sets it, edits keep it, loading anything
 * else clears it).
 */
export const showsDuration = (column: boolean, active: Recipe | undefined): boolean => column && !active?.ticker
