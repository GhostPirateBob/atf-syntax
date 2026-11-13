/**
 * Starting points: WACUP's own defaults, custom recipes, recipes for patchy tags or bare file
 * names, and a showcase. Click one and see which suits your own tracks.
 */
export interface Recipe {
  title: string
  group: 'WACUP defaults' | 'Custom recipes' | 'Patchy tags' | 'Only filenames' | 'Showcase'
  note: string
  format: string
  /**
   * A song ticker format: it ends in %length% itself (the ticker has no duration column), so the
   * preview leaves out its duration column while this recipe is loaded.
   */
  ticker?: true
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
    note: "gen_win10shell's three-line default, without the three spaces before the rating. $crlf() only adds a line when the next line has something in it.",
    format: "$if2(%title%,$filepart(%filename%))$if(%artist%,$crlf(),)%artist%[$if(%rating%,$rating(%filename%),)]$if(%album%,$crlf(),)%album%[$if(%year%,' ('%year%')',)]",
  },
  {
    title: "WACUP's default song ticker",
    group: 'WACUP defaults',
    note: 'Playlist number, artist (the album for SPC game music), title and length. %playlist_position% is a Taskbar Text field, so this belongs there, not in playlist titles.',
    format: "%playlist_position%. [$ifstrequal2($fileext(%filename%),SPC,%album%,%artist%) - ]$if2(%title%,$filepart(%filename%)) '('%length%')'",
    ticker: true,
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
    note: 'Each part is shortened by its own length, never the whole line\'s, so a column looks the same on every row.',
    format: '[$abbr(%artist%,20) ▸ ][$abbr(%album%,24) ▹ ]%title%',
  },
  {
    title: 'Cut long titles',
    group: 'Custom recipes',
    note: 'Keep the readable start of a long title instead of turning it into initials.',
    format: '[%artist% - ]$iflonger(%title%,30,$left(%title%,29)…,%title%)',
  },
  {
    title: 'Custom songticker',
    group: 'Custom recipes',
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
