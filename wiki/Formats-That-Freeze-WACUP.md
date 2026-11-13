Some formats are valid but never finish evaluating, so WACUP stops responding and its crash reporter writes a report. The extension reports these as errors, and **Copy Format as Single Line** warns before you paste one. Under the `wacup` dialect the message names the build that fixed it.

| Format | Freezes | Fixed in |
|---|---|---|
| `$replace` with an empty search | WACUP before 1.99.56.25334 (Winamp 5 [crashes](#winamp-5) instead) | 1.99.56.25334 |
| `$tab` or `$directory` with a negative count | WACUP before 1.99.57.25452, and Winamp 5 | 1.99.57.25452 |
| `$padcut` with a negative length | every WACUP build checked, up to 1.99.57.25464 (current), and Winamp 5 | not yet |

- **`$replace` with an empty search**: an empty search matches without moving forward, so the loop never ends. Since 1.99.56.25334 it no longer freezes, but an empty search makes `$replace` return nothing at all, so `$replace(%title%,%artist%,)` blanks the whole title of a track with no artist. On any build, give a search that might be empty some literal text or a fallback such as `$if2(%artist%,¤)`.
- **A negative count for `$tab` or `$directory`**: they count down to zero with no check for negatives, so `-1` loops about 4 billion times. Since 1.99.57.25452 a negative count outputs nothing. (`$repeat` and the `$path*` functions ignore negative counts.)
- **A negative length for `$padcut`**: `$padcut(abc,-1)` never returns, even when the string is empty. Zero and positive lengths work. Seen on WACUP 1.99.43.23234 and 1.99.57.25464, and on Winamp 5.666 and 5.9.2. The `negative-count` rule flags it.

## Untaken branches still run

Wrapping a freeze in `$if()` doesn't help. WACUP and Winamp 5 both evaluate every argument before calling a function, including the branch `$if` doesn't take. So `$if2(a,$padcut(a,-1))` freezes WACUP 1.99.57 and Winamp 5, even though `a` is never empty. The same goes for `$if`, `$if3`, `$ifgreater` and `[…]` sections.

You can see it without a freeze, too: `$if(a,b,$puts(x,1))$get(x)` gives `b1` in WACUP, because the `$puts` in the else branch still runs.

## Winamp 5

Winamp 5 has the `$tab`, `$directory` and `$padcut` freezes too. On several empty arguments it **crashes** instead, because it passes an empty argument to the function as a NULL pointer. WACUP doesn't crash on any of these (but see the `$replace` freeze above).

| Format | Winamp 5 |
|---|---|
| `$replace(x,,y)`: an empty search, even a computed one such as `%album%` for a track with no album | access violation |
| `$trim()` | access violation |
| `$pad(ab,5,)` or `$lpad(ab,5,)`: an empty pad string, even when no padding is needed | access violation |
| `$strchr(a,)`, `$strlchr(a,)` or `$strrchr(a,)`: an empty character; also `$strrchr(,a)` | access violation |
| `$split(x,,3)`: an empty token | access violation |
| `$padcut(ab,5,)`: an empty 3rd argument | access violation |
| `$padcut(ab,5,x)` or `$padcut(ab,5,x,)`: a custom argument but no pad string, when it has to pad | divide by zero |
| `$muldiv(1,,2)`: any empty argument | invalid parameter (C runtime) |
| `$div(-2147483648,-1)` or `$mod(-2147483648,-1)` | integer overflow |

Under the `winamp` dialect the `winamp-crash` rule flags these (an empty `$replace` search comes from `replace-empty-search`, and an empty `$muldiv` argument from `empty-number`). A field or call that can be empty gets a "may crash" message. **Copy Format as Single Line** warns when a format crashes Winamp 5, may crash it for some tracks, or freezes it.

All results come from the real engines, run directly: WACUP's own evaluator in the 1.99.43.23234 and 1.99.57.25464 builds, and Winamp 5.666 and 5.9.2's `tagz.w5s`. The fixing builds are from WACUP's developer ([#2](https://github.com/GhostPirateBob/atf-syntax/issues/2)) and the [WACUP changelog](https://getwacup.com/changelog/).
