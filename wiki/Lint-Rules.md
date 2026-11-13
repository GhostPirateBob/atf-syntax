<!-- Generated from RULES in src/lint.ts by scripts/wiki-lint-rules.js. Edit the rules there, not this page. -->

The extension has 20 lint rules. Change a rule's severity, or turn it off, with the `atf.lint.rules` setting, e.g. `{ "unknown-field": "off" }`. Each rule also has an anchor on the [docs page](https://ghostpiratebob.me/atf-syntax/extension/#rules).

| Rule | Default | What it catches |
|---|---|---|
| `syntax` | error | A syntax error. WACUP shows `[SYNTAX ERROR IN FORMATTING STRING (n)]` in place of the whole title, or of just the function argument or `[…]` section the error is in. |
| `too-deep` | warning | Nested more than 128 levels deep, so the format isn't checked. |
| `name-too-long` | error | WACUP 1.99.57: a `%field%` or `$function(` name longer than 32 characters shows `[TRUNCATED FORMATTING STRING -> MISSING END TAG / WORKING BUFFER TOO SMALL]` or `[SYNTAX ERROR IN FORMATTING STRING (4)]`. 1.99.43 and Winamp 5 accept it. |
| `unknown-function` | error | Function not in the WACUP/tagz function table; prints `[UNKNOWN FUNCTION -> $name]`. |
| `removed-function` | error | Documented but not callable (`$and`, `$greater`, `$fill`). |
| `dialect-function` | error | Function that only exists in the other dialect (e.g. `$strbetween` under `winamp`). |
| `arity-strict` | error | Wrong argument count for `$if`, `$if2`, `$ifgreater`, `$iflonger` or `$IfStrEqual*`; prints `[INVALID $name() SYNTAX]` (Winamp 5: `[INVALID $IF SYNTAX]`, `[INVALID $IFLONGER SYNTAX]` or `[INVALID $IFGREATER SYNTAX]`). |
| `arity-min` | warning | Too few arguments; the function silently outputs nothing. |
| `arity-max` | warning | Too many arguments; the function silently outputs nothing. |
| `too-many-args` | warning | More than 16 arguments; WACUP ignores the rest. |
| `empty-number` | warning | An empty numeric argument (e.g. `$left(%artist%,)`), which counts as 0. An empty `$muldiv` argument crashes Winamp 5. |
| `replace-empty-search` | error | `$replace(a,,b)`: an empty search string never advances, so WACUP freezes and has to be killed (Winamp 5 crashes). Fixed in WACUP 1.99.56.25334. |
| `replace-search-may-be-empty` | warning | `$replace` search made only of fields or calls (e.g. `%artist%`); if it is empty for a track, WACUP freezes (Winamp 5 crashes). Fixed in WACUP 1.99.56.25334. |
| `negative-count` | error | `$tab(-1)`, `$directory(path,-1)` or `$padcut(a,-1)`: a negative count never finishes, so WACUP freezes. `$tab`/`$directory` fixed in WACUP 1.99.57.25452; `$padcut` still freezes in 1.99.57.25464. |
| `winamp-crash` | error | Winamp 5: an argument that crashes it, e.g. an empty `$trim()`, `$pad`/`$lpad` pad string, `$strchr` character or `$split` token, or `$div(-2147483648,-1)`. Fields and calls that can be empty get a "may crash" message. |
| `always-true-condition` | warning | WACUP: `$if($strchr(…),…)` and similar always take the first branch, because the result is never empty. `$if($strstr(…),…)` only tests that its arguments aren't empty. |
| `always-false-condition` | warning | Winamp 5: a condition with no `%field%` always takes the else branch. |
| `get-before-put` | warning | `$get(x)` before any `$puts`/`$put` sets `x`. |
| `unknown-field` | hint | Field not known to WACUP (input plugins may still provide it). |
| `cond-without-field` | hint | `[…]` containing no `%field%`, so it is never displayed. |
