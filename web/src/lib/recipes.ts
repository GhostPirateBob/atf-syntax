/**
 * Starting points, grouped by what data you have rather than by library layout: click one and
 * see which suits your own tracks.
 */
export interface Recipe {
  title: string
  group: 'WACUP defaults' | 'Good tags' | 'Patchy tags' | 'Only filenames' | 'Showcase'
  note: string
  format: string
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
    note: "gen_win10shell's three-line default. $crlf() only adds a line when the next line has something in it.",
    format: "$if2(%title%,$filepart(%filename%))$if(%artist%,$crlf(),)%artist%[   $if(%rating%,$rating(%filename%),)]$if(%album%,$crlf(),)%album%[$if(%year%,' ('%year%')',)]",
  },
  {
    title: 'Album artist first',
    group: 'Good tags',
    note: 'Album artist stays the same across an album, so the column does not jump on "feat." tracks.',
    format: '[$if2(%albumartist%,%artist%) - ]%title%',
  },
  {
    title: 'Numbered tracks',
    group: 'Good tags',
    note: 'Two-digit track numbers, dropped when a track has none.',
    format: '[$num(%tracknumber%,2). ][%artist% - ]%title%',
  },
  {
    title: 'Long albums to initials',
    group: 'Good tags',
    note: 'Each part is shortened by its own length, never the whole line\'s, so a column looks the same on every row.',
    format: '[$abbr(%artist%,22) ▸ ][$abbr(%album%,25) ▹ ]%title%',
  },
  {
    title: 'Cut long titles',
    group: 'Good tags',
    note: 'Keep the readable start of a long title instead of turning it into initials.',
    format: '[%artist% - ]$iflonger(%title%,30,$left(%title%,29)…,%title%)',
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
    title: 'Abbreviated columns, with the dot trick',
    group: 'Showcase',
    note: 'WACUP trims leading whitespace, so this starts with a "." that scrolls off the left of the playlist. Strips "feat."/"ft" from the artist and cuts long titles.',
    format: ".   ⇢   $puts(t,$if2(%title%,$filepart(%filename%)))$puts(araw,$if2(%albumartist%,%artist%))$puts(fp,$strstr($replace($replace($lower($get(araw)),'(',' '),' ft',' feat'),' feat'))$puts(a,$trim($ifgreater($get(fp),0,$left($get(araw),$sub($get(fp),1)),$get(araw))))$if($get(a),$abbr($get(a),20) ▸ ,)[$abbr(%album%,18) ▹ ]$iflonger($get(t),30,$left($get(t),29)…,$get(t))",
  },
]
