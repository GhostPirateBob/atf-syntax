These are the numbers WACUP prints in `[SYNTAX ERROR IN FORMATTING STRING (n)]`. Neither WACUP nor Winamp documents them; this table describes what WACUP 1.99.43 reports.

| Code | Meaning | Typical cause |
|---|---|---|
| 2 | `%` with no closing `%` (WACUP shows `[TRUNCATED FORMATTING STRING…]`) | `%artist - ` |
| 3 | `$name` with no `(` | `$if2` at the end of the string |
| 4 | `$name(` with no balanced `)` | a missing `)`, or a stray `[` or `'` inside the call |
| 6 | an argument with an unbalanced `(`/`[`/quote | |
| 7 | `'` with no closing `'` | `'abc` |
| 8 | `[` with no balanced `]` | `[%album% - ` |
| 9 | bare `]`, `(` or `)` in text | `feat)`: write `')'` or `$rightbracket()` |

A syntax error replaces the **whole** title. Unknown functions (`[UNKNOWN FUNCTION -> $x]`) and wrong argument counts (`[INVALID $if() SYNTAX]`) only replace the call itself.
