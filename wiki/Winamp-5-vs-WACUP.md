The `atf.dialect` setting picks the player the extension checks against: `wacup` (WACUP 1.99.x, the default) or `winamp` (classic Winamp 5). Both use the same syntax and parser, but they evaluate some formats differently. Everything here was checked by running the formats through WACUP 1.99.43 and 1.99.57 and Winamp 5.666 and 5.9.2. The two Winamp builds behave the same. The hovers note these differences too.

## `$if` and `$if2`

WACUP takes the first branch when the condition's text isn't empty. Winamp 5 takes it when the condition contains a `%field%` that has a value, whatever the text comes out as.

| Format | WACUP | Winamp 5 |
|---|---|---|
| `$if(abc,yes,no)` | `yes` | `no` |
| `$if(x%album%,yes,no)`, for a track with no album | `yes` | `no` |
| `$if($left(%artist%,0),yes,no)`, for a track with an artist | `no` | `yes` |

So under `winamp` the `always-false-condition` rule warns about a condition with no field, and under `wacup` the `always-true-condition` rule warns about one that is never empty, such as `$strchr(…)`.

## Every argument runs, in both

Neither player skips the branch `$if` doesn't take. Both evaluate every argument first, so `$if(a,b,$puts(x,1))$get(x)` gives `b1` in WACUP and `1` in Winamp 5 (which takes the else branch, as `a` has no field). A format that freezes in an untaken branch still freezes either player: see [Formats That Freeze WACUP](Formats-That-Freeze-WACUP#untaken-branches-still-run).

## Functions only in WACUP

Winamp 5 prints `[UNKNOWN FUNCTION]` for these: `$strbetween`, `$padout`, `$lpadout`, `$leftbracket`, `$rightbracket`, `$is_stream`, `$rating` and `$bitdepth`. Under `winamp` the `dialect-function` rule flags them.

## Error texts

Winamp 5's errors have no code or detail: `[SYNTAX ERROR IN FORMATTING STRING]`, `[UNKNOWN FUNCTION]`, `[INVALID $IF SYNTAX]` and so on. WACUP drops the text before an unknown function in the same scope, while Winamp 5 keeps it: `x$foo(y)z` gives `[UNKNOWN FUNCTION -> $foo(y)z]z` in WACUP and `x[UNKNOWN FUNCTION]z` in Winamp 5. See [Error Codes](Error-Codes#winamp-5).

## Crashes

Winamp 5 passes an empty argument to a function as a NULL pointer, so several empty arguments crash it where WACUP just outputs something: an empty `$replace` search, `$trim()`, an empty `$pad`/`$lpad` pad string, an empty `$strchr` character or `$split` token, and others. `$div(-2147483648,-1)` and `$mod(-2147483648,-1)` crash it with an integer overflow. The full list is in [Formats That Freeze WACUP](Formats-That-Freeze-WACUP#winamp-5). Under `winamp` the `winamp-crash` rule flags them.

## Other functions

| Format | WACUP | Winamp 5 |
|---|---|---|
| `$substr(abcdef,2,3)` | `bcd` | `abcdef` (it never takes a substring) |
| `x$trim(  a  )y` | `xay` | `xa  y` (it trims only the start) |
| `$ext(a.tar.gz)`, `$fileext(a.tar.gz)` | `GZ` | `gz` |
| `$filename(C:\a\b.mp3)` | `b.mp3` | `b` |
| `$caps(it''s o''neil-smith)` | `It's O'neil-Smith` | `It'S O'Neil-Smith` |
| `$abbr(Rock-n-Roll II)` | `R-n-RII` | `RI` |
| `$abbr(Advanced Title Formatting,1,2)` | `ATF` | nothing (it takes at most 2 arguments) |
| `$len(😀)` | `2` (UTF-16 code units) | `1` (characters) |
| `$left(e$char(769)x,1)` | `e` | `é` (the combining accent stays with its letter) |
| `$pad(ab,8,xy)` | `abxyxyxyxyxyxy` | `abyxyxyx` |
| `$put(,v)` | nothing | `v` |
| `$puts(x,a)$puts(x,)$get(x)` | `a` | nothing |
| `$strstr(,x)` | nothing | `0` |
| `$decode(a,b,c)`, with no else | `c` | nothing |
| `$char(-1)` | nothing | U+FFFF |
