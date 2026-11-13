/**
 * Function and field data for WACUP 1.99.43 and classic Winamp 5. Descriptions are written for this
 * extension from the public ATF help, the WACUP changelogs and observed behaviour.
 *
 * @module catalog
 */

/**
 * The ATF implementation to target. A string union rather than an `enum`, because it is also the
 * value of the `atf.dialect` setting.
 * - `wacup`: WACUP 1.99.x. `$if` family tests for a non-empty string; extra functions.
 * - `winamp`: classic Winamp 5 tagz. `$if` family tests for resolved `%fields%`.
 */
export type Dialect = 'wacup' | 'winamp';

/** How the grammar and completion classify a function. */
export type FunctionKind = 'control' | 'variable' | 'function';

/** One built-in function. Names are lower-case keys; ATF function lookup is case-insensitive. */
export interface FunctionInfo {
  name: string;
  /** Parameter list for hovers and completion, e.g. `(a, then, else)`. */
  sig: string;
  /** Markdown description. */
  doc: string;
  /**
   * Exact argument count. Anything else prints `[INVALID $name() SYNTAX]` in place in WACUP. Winamp 5
   * prints `[INVALID $IF SYNTAX]` (`$if`, `$if2`, `$ifstrequal…`), `[INVALID $IFLONGER SYNTAX]` or
   * `[INVALID $IFGREATER SYNTAX]`.
   */
  exact?: number;
  /** Minimum count (fewer silently outputs nothing). `$f()` counts as one empty argument. */
  min?: number;
  /** Maximum count under WACUP. */
  max?: number;
  /** Maximum count under Winamp 5, where it differs. */
  maxWinamp?: number;
  /** Set when the function exists in only one dialect. */
  only?: Dialect;
  kind: FunctionKind;
}

const F = (name: string, sig: string, doc: string, extra: Partial<FunctionInfo> = {}): FunctionInfo => ({
  name,
  sig,
  doc,
  kind: 'function',
  ...extra,
});
const C = (name: string, sig: string, doc: string, extra: Partial<FunctionInfo> = {}) => F(name, sig, doc, { kind: 'control', ...extra });

/** Every built-in function in WACUP 1.99.43, plus classic Winamp 5 equivalents. */
export const FUNCTIONS: FunctionInfo[] = [
  C('if', '(a, then, else)', '*then* if *a* is non-empty (WACUP) / contains a resolved %field% (Winamp 5), otherwise *else*. `$if(A,A,B)` ≡ `$if2(A,B)`.', { exact: 3 }),
  C('if2', '(a, else)', '*a* if non-empty (WACUP) / has a resolved %field% (Winamp 5), otherwise *else*.', { exact: 2 }),
  C('if3', '(a1, …, aN, else)', 'The first non-empty *ai*, otherwise *else*.', { min: 1 }),
  C('decode', '(a, b1, c1, …, bN, cN, else)', 'Switch: *ci* where *a* = *bi*, otherwise *else*. Case-insensitive, ASCII only in WACUP; empty strings never match. With no *else*, WACUP gives the last *ci* and Winamp 5 nothing.', { min: 2 }),
  C('ifgreater', '(x1, x2, then, else)', 'Integer compare: *then* if x1 > x2, otherwise *else*.', { exact: 4 }),
  C('iflonger', '(a1, x1, then, else)', '*then* if len(a1) > x1, otherwise *else*.', { exact: 4 }),
  C('ifstrequal', '(A, B, then)', '*then* if A = B (case-insensitive, ASCII only in WACUP; empty strings never match), otherwise nothing.', { exact: 3 }),
  C('ifstrequal2', '(A, B, then, else)', 'A = B (case-insensitive, ASCII only in WACUP; empty strings never match) ? *then* : *else*.', { exact: 4 }),
  C('ifstrnotequal', '(A, B, then)', '*then* if A ≠ B (case-insensitive, ASCII only in WACUP), otherwise nothing. Two empty strings give nothing in WACUP 1.99.57 (*then* in 1.99.43 and Winamp 5).', { exact: 3 }),
  C('select', '(n, a1, …, aN)', 'The *n*-th of a1…aN (1-based). Out of range or negative → nothing; `0` or a non-number prints *n* itself. The 16-argument limit makes a15 the last reachable.', { min: 2 }),

  F('add', '(x1, …, xn)', 'Integer sum.'),
  F('sub', '(x1, …, xn)', 'x1 − x2 − … − xn.'),
  F('mul', '(x1, …, xn)', 'Integer product.'),
  F('div', '(x1, …, xn)', 'Integer division, left to right. Dividing by 0 leaves the value unchanged: `$div(7,0)` → `7`. `$div(-2147483648,-1)` outputs nothing (crashes Winamp 5).'),
  F('mod', '(x1, …, xn)', 'Remainder, left to right. `$mod(21,8)` → `5`. A divisor of 0 leaves the value unchanged: `$mod(7,0)` → `7`. `$mod(-2147483648,-1)` outputs nothing (crashes Winamp 5).'),
  F('muldiv', '(x1, x2, x3)', 'x1·x2/x3, rounded to nearest. `$muldiv(10,6,3)` → `20`. Exactly 3 arguments, otherwise nothing. An empty argument crashes Winamp 5.', { min: 3, max: 3 }),
  F('min', '(x1, …, xn)', 'Smallest integer.'),
  F('max', '(x1, …, xn)', 'Largest integer.'),

  F('lower', '(a1)', 'Lower case.'),
  F('upper', '(a1)', 'Upper case.'),
  F('replace', '(a1, a2, a3[, icase])', 'a1 with every a2 replaced by a3. `icase` exactly `1` → case-insensitive (WACUP 1.99.56+; Winamp 5 ignores it). **An empty a2 freezes WACUP before 1.99.56.25334** (the search never advances), and outputs nothing since. **It crashes Winamp 5**, even when the search is computed.', { min: 3 }),
  F('left', '(a1, n)', 'First n UTF-16 code units (Winamp 5: characters, so a combining mark stays with its letter). Since WACUP 1.99.56.25334 a negative n gives nothing: `$left(abcdef,-2)` outputs nothing (1.99.43 gave `abcdef`).', { min: 2 }),
  F('cut', '(a1, n)', 'First n UTF-16 code units (Winamp 5: characters). Since WACUP 1.99.55.25130 a negative n cuts that many off the end: `$cut(abcdef,-2)` → `abcd` (1.99.43 gave `abcdef`).', { min: 2 }),
  F('right', '(a1, n)', 'Last n UTF-16 code units (Winamp 5: characters). An n longer than a1 gives nothing: `$right(abc,5)` outputs nothing.', { min: 2 }),
  F('len', '(a1)', 'Length in UTF-16 code units: `$len(😀)` → `2` (Winamp 5 counts characters: `1`). Always non-empty (`0`).'),
  F('substr', '(a1, from[, length])', 'Up to *length* characters from *from*: `$substr(abcdef,2,3)` → `bcd`. 1-based since WACUP b7138 (0-based before); a negative offset counts from the end (b7120). *from* counts code units, *length* counts characters (a surrogate pair is one); with a 4th argument *length* is ignored. Winamp 5 never takes a substring: it outputs all of a1 or nothing.', { min: 2 }),
  F('strstr', '(a1, a2)', '1-based index of a2 in a1 (case-sensitive), `0` if not found. Nothing if either argument is empty (Winamp 5: `0`). Exactly 2 arguments, otherwise nothing.', { min: 2, max: 2 }),
  F('strchr', '(a1, c)', 'Index of first character c (case-sensitive), `0` if none or if a1 is empty. Nothing for an empty c (crashes Winamp 5). Exactly 2 arguments, otherwise nothing.', { min: 2, max: 2 }),
  F('strlchr', '(a1, c)', 'Index of first character c (case-sensitive), `0` if none or if a1 is empty. Nothing for an empty c (crashes Winamp 5). Exactly 2 arguments, otherwise nothing.', { min: 2, max: 2 }),
  F('strrchr', '(a1, c)', 'Index of last character c (case-sensitive), `0` if none or if a1 is empty. Nothing for an empty c. An empty a1 or c crashes Winamp 5. Exactly 2 arguments, otherwise nothing.', { min: 2, max: 2 }),
  F('strbetween', '(str, start, end)', "Text between *start* and *end*: `$strbetween('title [other info]','[',']')` → `other info`; empty if no match (WACUP changelog b7138).", { min: 3, only: 'wacup' }),
  F('shortest', '(a1, a2, …)', 'The shortest argument.'),
  F('longest', '(a1, a2, …)', 'The longest argument.'),
  F('abbr', '(a1[, minlen[, case]])', '**Initials** (not truncation): `$abbr(Advanced Title Formatting)` → `ATF`. Punctuation is kept and starts a new word; Roman numerals, numbers and words like `x2` stay whole: `$abbr(Rock-n-Roll II)` → `R-n-RII` (Winamp 5: `RI`). Only when len ≥ minlen. case: 1 lower, 2 upper (WACUP; a 3rd argument makes Winamp 5 output nothing).', { max: 3, maxWinamp: 2 }),
  F('padcut', '(a1, n[, custom, padstr])', 'Pad with spaces or cut to exactly n. A non-empty *custom* pads from *padstr* instead: `$padcut(ab,5,x,y)` → `abyyy`; with no or an empty *padstr* there is no padding (and Winamp 5 crashes if padding is needed). An empty *custom* crashes Winamp 5. **A negative n freezes WACUP**, still on 1.99.57.25464 (the newest build checked).', { min: 2 }),
  F('pad', '(s, n[, padstr])', 'Right-pad to at least n, appending the whole *padstr* (n − length) times: `$pad(ab,8,xy)` → `abxyxyxyxyxyxy` (Winamp 5: `abyxyxyx`). `$pad(*5,#)` → `#####`; `$pad(3)` → two spaces (Winamp 5: `*5` and nothing). An empty *padstr* crashes Winamp 5.', { min: 2 }),
  F('lpad', '(s, n[, padstr])', 'Left-pad to at least n with single *padstr* characters, counting down: `$lpad(ab,5,xy)` → `xyxab`. `$lpad(%tracknumber%,3,0)`. An empty *padstr* crashes Winamp 5.', { min: 2 }),
  F('padout', '(s, n[, padstr])', 'Like `$pad`, but appends *padstr* *n* times whatever the length of *s*: `$padout(ab,3,xy)` → `abxyxyxy` (WACUP changelog b4994).', { min: 2, only: 'wacup' }),
  F('lpadout', '(s, n[, padstr])', 'Like `$lpad`, but prepends *n* characters whatever the length of *s*: `$lpadout(ab,3,xy)` → `xyxab` (WACUP changelog b4994).', { min: 2, only: 'wacup' }),
  F('trim', '(a1)', 'Strip leading and trailing whitespace, including tabs, NBSP and U+3000. (Winamp 5 trims only the start, and an empty argument crashes it.)'),
  F('repeat', '(a1, n)', 'a1 repeated n times. `$repeat(*,%rating%)`.', { min: 2 }),
  F('caps', '(a1)', "Lower-case, then capitalise each word. Punctuation starts a word, but an apostrophe doesn't: `$caps(it''s o''neil-smith)` → `It's O'neil-Smith` (Winamp 5: `It'S O'Neil-Smith`)."),
  F('caps2', '(a1)', 'Capitalise each word, rest untouched. Words break as in `$caps`.'),
  F('split', '(a, token, which)', '*which* `0`: the text before the first *token* (all of *a* if there is none). *which* n: **everything after** the n-th *token*, so `$split(a/b/c,/,1)` → `b/c`, or nothing if there are fewer tokens. `$split(%track%,/,1)` gets the total from `3/12`.', { min: 3, max: 3 }),
  F('hex', '(x, digits)', 'Hexadecimal, zero-padded. Exactly 2 arguments, otherwise nothing.', { min: 2, max: 2 }),
  F('num', '(x, digits)', 'Decimal, zero-padded. `$num(%track%,2)`. Exactly 2 arguments, otherwise nothing.', { min: 2, max: 2 }),
  F('dec', '(x, digits)', 'Same as `$num`.', { min: 2, max: 2 }),
  F('char', '(code)', 'The character with code point *code*: `$char(9733)` → ★, `$char(128512)` → 😀. 0 or less gives nothing; from 65535 up it gives a supplementary character, wrapping round (`$char(65535)` → U+10FFFF). (Winamp 5 keeps only the low 16 bits: `$char(-1)` → U+FFFF.)', { min: 1, max: 1 }),
  F('leftbracket', '()', 'Outputs `(` — a literal parenthesis without quoting. Undocumented.', { only: 'wacup' }),
  F('rightbracket', '()', 'Outputs `)`. Undocumented.', { only: 'wacup' }),
  F('crlf', '()', 'CR LF.'),
  F('tab', '([n])', 'n tab characters. `$tab()` outputs none, because its empty argument counts as 0. **A negative n freezes WACUP before 1.99.57.25452, and Winamp 5** (it counts down from -1 through ~4 billion).'),
  F('null', '(…)', 'Outputs nothing (a placeholder).'),

  F('filepart', '(path)', 'File name **without path and extension**. WACUP 1.99.54.24960 left the period in; 1.99.55.25130 fixed it. With no extension WACUP 1.99.57 gives nothing (1.99.43 and Winamp 5 give the name).'),
  F('filename', '(path)', 'File name with extension; a trailing backslash is kept: `$filename(C:\\a\\dir\\)` → `dir\\`. (Winamp 5 strips the extension here too.)'),
  F('fileext', '(path)', 'Last file extension, upper-cased, stopping at a `:`: `$fileext(a.tar.gz)` → `GZ`. (Winamp 5 keeps the original case.)'),
  F('ext', '(path)', 'Last file extension, upper-cased, stopping at a `:`: `$ext(a.tar.gz)` → `GZ`. (Winamp 5 keeps the original case.)'),
  F('directory', '(path[, levels])', 'Directory name *levels* up (default 1). 0 levels gives nothing in WACUP 1.99.57 (the file name in 1.99.43 and Winamp 5). **A negative levels freezes WACUP before 1.99.57.25452, and Winamp 5** (it counts down from -1 through ~4 billion).'),
  F('pathltrim', '(path[, n])', 'Path minus the first n levels (default 1).'),
  F('pathlpart', '(path[, n])', 'First n levels of path (default 1); the drive is a level: `$pathlpart(C:\\a\\b,1)` → `C:\\`.'),
  F('pathrtrim', '(path[, n])', 'Meant to drop the last n levels (default 1), but its results are unreliable: `$pathrtrim(C:\\a\\b\\c\\d,1)` → `C:`. Prefer `$pathlpart`.'),
  F('pathrpart', '(path[, n])', 'Last n levels of path (default 1).'),
  F('pathsafe', '(a1)', 'Makes *a1* safe as a file name: `/ \\ :` → `-`, `* ? |` → `_`, `<` → `(`, `>` → `)`, `"` → `\'`; control characters are removed. Reserved names and trailing dots are left alone.'),

  F('puts', '(name, value)', "Store *value* in variable *name*; outputs nothing. An empty value doesn't overwrite: `$puts(x,a)$puts(x,)$get(x)` → `a` (Winamp 5: nothing). Names are case-insensitive for ASCII only.", { min: 2, kind: 'variable' }),
  F('put', '(name, value)', 'Store *value* in variable *name* and output it. An empty name or value stores and outputs nothing (Winamp 5: `$put(,v)` → `v`).', { min: 2, kind: 'variable' }),
  F('get', '(name)', 'Value of variable *name* (empty if unset).', { min: 1, kind: 'variable' }),

  F('systime_year', '()', 'Current year.'),
  F('systime_month', '()', 'Current month, not zero-padded (Winamp 5: 2 digits).'),
  F('systime_day', '()', 'Current day, not zero-padded (Winamp 5: 2 digits).'),
  F('systime_hour', '()', 'Current hour, not zero-padded (Winamp 5: 2 digits).'),
  F('systime_minute', '()', 'Current minute, not zero-padded (Winamp 5: 2 digits).'),
  F('systime_second', '()', 'Current second, not zero-padded (Winamp 5: 2 digits).'),
  F('is_stream', '(path)', 'Non-empty if *path* is a URL/stream, e.g. `$is_stream(%filename%)`. Since b22960, zip and CD entries no longer count (WACUP changelog b2740).', { only: 'wacup' }),
  F('rating', '([filename][, star_mode])', 'Rating of *filename* (default: the current track) as `★` repeated; a non-zero star_mode uses `*` instead. Empty if unrated.', { only: 'wacup' }),
  F('bitdepth', '([filename])', 'Bit depth of *filename* (default: the current track), from its `bitdepth` metadata.', { only: 'wacup' }),
];

/** Documented somewhere but not callable: prints `[UNKNOWN FUNCTION]`. Maps name → explanation and replacement. */
export const REMOVED: Record<string, string> = {
  and: 'Removed (the docs say so; it is not in the WACUP/tagz function table).',
  greater: 'Documented, but absent from the WACUP and tagz function tables. Use `$ifgreater(x1,x2,then,else)`.',
  fill: 'Removed after Winamp 5.21. Use `$repeat(a,n)`.',
};

/** Lower-case name → function. */
export const FUNCTION_MAP = new Map(FUNCTIONS.map((f) => [f.name, f]));

/** One known `%field%`. Unknown fields are allowed (plugins can provide any), only hinted. */
export interface FieldInfo {
  /** Lower-case name without `%`. */
  name: string;
  /** Markdown description. */
  doc: string;
}

const fields: [string, string][] = [
  ['filename', 'Full path of the file. Use `$filepart()` for the name only.'],
  ['folder', 'Containing folder.'],
  ['fullfolder', 'Full folder path with trailing backslash (WACUP).'],
  ['rating', 'Media Library rating 1–5.'],
  ['playcount', 'Media Library play count.'],
  ['artist', 'Artist.'],
  ['title', 'Title.'],
  ['album', 'Album.'],
  ['year', 'Year.'],
  ['genre', 'Genre.'],
  ['comment', 'Comment.'],
  ['tracknumber', 'Track number, unpadded.'],
  ['track', 'Same as %tracknumber%.'],
  ['albumartist', 'Album artist.'],
  ['trackartist', 'Track artist, if different to the album artist.'],
  ['disc', 'Disc number, e.g. `1/2`.'],
  ['composer', 'Composer.'],
  ['publisher', 'Publisher (record label).'],
  ['streamtitle', 'Stream title.'],
  ['bitrate', 'Bitrate (average for VBR).'],
  ['samplerate', 'Sample rate, e.g. 48000 (WACUP).'],
  ['length', 'WACUP playlist: formatted `4:20`. Winamp 5 / WACUP Taskbar Text: milliseconds.'],
  ['length_seconds', 'Length in seconds (WACUP).'],
  ['type', '1 = video, 0 = audio.'],
  ['vbr', '1 = VBR, 0 = CBR.'],
  ['category', 'Category.'],
  ['producer', 'Producer.'],
  ['director', 'Director.'],
  ['mood', 'Mood.'],
  ['bpm', 'Beats per minute.'],
  ['key', 'Musical key, e.g. E Minor.'],
  ['lyricist', 'Lyricist.'],
  ['conductor', 'Conductor.'],
  ['tool', 'Encoding/ripping software.'],
  ['family', 'File type family, e.g. MPEG-4 Audio File Format.'],
  ['encoder', 'Encoder, e.g. LAME 3.100.'],
  ['isrc', 'International Standard Recording Code.'],
  ['replaygain_track_gain', 'ReplayGain track gain.'],
  ['replaygain_album_gain', 'ReplayGain album gain.'],
  ['replaygain_track_peak', 'ReplayGain track peak.'],
  ['replaygain_album_peak', 'ReplayGain album peak.'],
  ['gain', 'Gain.'],
  ['wacup_version', 'WACUP version.'],
  ['timestamp', 'Timestamp (WACUP changelog).'],
  ['samplerate_khz', 'Sample rate in kHz (WACUP changelog).'],
  ['lastplayed', 'Last played time (WACUP changelog).'],
  ['dateadded', 'Date added to the library (WACUP changelog).'],
  ['filetime', 'File modification time (WACUP changelog).'],
  ['filesize', 'File size (WACUP changelog).'],
  ['ispodcast', 'Whether the item is a podcast (WACUP changelog).'],
  ['podcastchannel', 'Podcast channel (WACUP changelog).'],
  ['podcastpubdate', 'Podcast publish date (WACUP changelog).'],
  ['streamtype', 'Stream type (WACUP changelog).'],
  ['playlist_position', 'Taskbar Text only: playlist position.'],
  ['playlist_length', 'Taskbar Text only: playlist length.'],
  ['playback_time', 'Taskbar Text only: time played, [hh:]mm:ss.'],
  ['playback_time_ms', 'Taskbar Text only: time played in ms.'],
  ['playback_time_remaining', 'Taskbar Text only: time remaining, [hh:]mm:ss.'],
  ['playback_time_remaining_ms', 'Taskbar Text only: time remaining in ms.'],
];

/** Known fields: WACUP/ML/input-plugin standard fields, WACUP changelog additions and Taskbar Text extras. */
export const FIELDS: FieldInfo[] = fields.map(([name, doc]) => ({ name, doc }));
/** Lower-case name → field. */
export const FIELD_MAP = new Map(FIELDS.map((f) => [f.name, f]));

/**
 * 0-based indexes of integer arguments (an empty or non-numeric value counts as 0).
 * An empty argument here is almost always a typo, e.g. `$left(%artist%,)20`.
 */
export const NUMERIC_ARGS: Record<string, number[]> = {
  left: [1],
  cut: [1],
  right: [1],
  padcut: [1],
  pad: [1],
  lpad: [1],
  padout: [1],
  lpadout: [1],
  repeat: [1],
  num: [1],
  dec: [1],
  hex: [1],
  substr: [1],
  iflonger: [1],
  ifgreater: [0, 1],
  div: [0, 1],
  mod: [0, 1],
  muldiv: [0, 1, 2],
  pathltrim: [1],
  pathlpart: [1],
  pathrtrim: [1],
  pathrpart: [1],
  split: [2],
  select: [0],
  char: [0],
};

/**
 * 0-based index of a count argument that freezes WACUP when negative. `$tab` and `$directory` loop
 * with `while (n--)` and no clamp (~4 billion times, Winamp 5 too); `$padcut` reads its length into a `size_t`, so it pads
 * ~4 billion characters (confirmed by WACUP's developer, who says 1.99.58.x will fix it).
 * `$repeat` and the `$path*` functions clamp.
 */
export const NEGATIVE_COUNT_FREEZES: Record<string, number> = { tab: 0, directory: 1, padcut: 1 };

/**
 * Functions whose output is never empty with the right argument count — `$if(<one of these>,…)` is
 * always true in WACUP. `$strchr`'s family is empty only for an empty character argument, and
 * `$div`/`$mod` only for `-2147483648,-1`. `$strstr` is left out: it is empty when either argument is.
 */
export const ALWAYS_NONEMPTY = new Set(['strchr', 'strlchr', 'strrchr', 'len', 'add', 'sub', 'mul', 'div', 'mod', 'muldiv', 'min', 'max', 'num', 'dec', 'hex']);
