These are the numbers WACUP prints in `[SYNTAX ERROR IN FORMATTING STRING (n)]`. Neither WACUP nor Winamp documents them; this table describes what WACUP 1.99.43 and 1.99.57 report.

| Code | Meaning | Typical cause |
|---|---|---|
| 2 | `%` with no closing `%` (WACUP shows `[TRUNCATED FORMATTING STRING…]`) | `%artist - ` |
| 3 | `$name` with no `(` | `$if2` at the end of the string |
| 4 | `$name(` with no balanced `)` | a missing `)`, or a stray `[` or `'` inside the call |
| 6 | an argument with an unbalanced `(`/`[`/quote | |
| 7 | `'` with no closing `'` | `'abc` |
| 8 | `[` with no balanced `]` | `[%album% - ` |
| 9 | bare `]`, `(` or `)` in text | `feat)`: write `')'` or `$rightbracket()` |

## Where the error appears

A syntax error replaces only the scope it's in. At the top level that's the whole title. Inside a function argument or a `[…]` section it's just that argument or section, and the rest of the title is fine:

| Format | WACUP shows |
|---|---|
| `abc(def` | `[SYNTAX ERROR IN FORMATTING STRING (9)]` |
| `abc$upper(x(y)z)def` | `abc[SYNTAX ERROR IN FORMATTING STRING (9)]def` |
| `abc$lower(x(y)z)def` | `abc[syntax error in formatting string (9)]def` |
| `a[x(y)z]b` | `ab` (the section has no field, so it's hidden) |

The error text becomes the argument's value, so the function still runs on it: `$lower` lowercases it.

Unknown functions and wrong argument counts work differently. WACUP drops the text before the call in the same scope, and the message repeats the rest of the scope: `x$foo(y)z` gives `[UNKNOWN FUNCTION -> $foo(y)z]z`, and `x$if(a,b)z` gives `[INVALID $if() SYNTAX -> if(a,b)z]z`.

## Long names

WACUP 1.99.57 rejects a field or function name longer than 32 characters (UTF-16 code units). A field gives `[TRUNCATED FORMATTING STRING -> MISSING END TAG / WORKING BUFFER TOO SMALL]` and a function gives error (4), in place of the scope as above. 32 characters is fine, and 1.99.43 and Winamp 5 accept any length. The `name-too-long` rule flags these.

## Winamp 5

Winamp 5 fails on the same formats, in the same scope, but its error texts are plain, with no code or detail:

- `[SYNTAX ERROR IN FORMATTING STRING]`, for every syntax error, including a `%` with no closing `%`
- `[UNKNOWN FUNCTION]`
- `[INVALID $IF SYNTAX]` (`$if`, `$if2` and `$IfStrEqual*`), `[INVALID $IFLONGER SYNTAX]` and `[INVALID $IFGREATER SYNTAX]`

It also puts an unknown function's error in place and keeps the text before it: `x$foo(y)z` gives `x[UNKNOWN FUNCTION]z`.

All examples were checked on WACUP 1.99.43.23234 and 1.99.57.25464 and Winamp 5.666 and 5.9.2.
