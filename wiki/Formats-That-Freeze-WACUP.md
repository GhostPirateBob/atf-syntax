Some formats are valid but never finish evaluating, so WACUP stops responding and its crash reporter writes a report. The extension reports these as errors, and **Copy Format as Single Line** warns before you paste one. Under the `wacup` dialect the message names the build that fixed it.

| Format | Freezes | Fixed in |
|---|---|---|
| `$replace` with an empty search | WACUP before 1.99.56.25334, and Winamp 5 | 1.99.56.25334 |
| `$tab` or `$directory` with a negative count | WACUP before 1.99.57.25452, and Winamp 5 | 1.99.57.25452 |
| `$padcut` with a negative length | every WACUP build checked, up to 1.99.57.25464 (current) | not yet |

- **`$replace` with an empty search**: an empty search matches without moving forward, so the loop never ends. Wrapping the call in `$if()` doesn't help, because ATF evaluates every argument before calling the function. Since 1.99.56.25334 it no longer freezes, but an empty search makes `$replace` return nothing at all, so `$replace(%title%,%artist%,)` blanks the whole title of a track with no artist. On any build, give a search that might be empty some literal text or a fallback such as `$if2(%artist%,¤)`.
- **A negative count for `$tab` or `$directory`**: they count down to zero with no check for negatives, so `-1` loops about 4 billion times. Since 1.99.57.25452 a negative count outputs nothing. (`$repeat` and the `$path*` functions ignore negative counts.)
- **A negative length for `$padcut`**: `$padcut(abc,-1)` never returns, even when the string is empty. Zero and positive lengths work. Seen on 1.99.43.23234 and 1.99.57.25464; the extension doesn't flag it yet.

Winamp 5's title formatting has the same `$replace`, `$tab` and `$directory` loops. `$padcut` hasn't been checked there.

All results come from WACUP's own evaluator: the 1.99.43.23234 and 1.99.57.25464 builds, run directly. The fixing builds are from WACUP's developer ([#2](https://github.com/GhostPirateBob/atf-syntax/issues/2)) and the [WACUP changelog](https://getwacup.com/changelog/).
