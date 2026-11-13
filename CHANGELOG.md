# Changelog

Changes to the extension. The web playground has its own changelog: [web/CHANGELOG.md](web/CHANGELOG.md).

## 0.5.0 — 2026-11-13

- New: the [ATF playground](https://ghostpiratebob.me/atf-syntax/), a web page where you type a format and see it render live for sample tracks or your own playlist, with the same checking as this extension. Its evaluator was checked against WACUP 1.99.57.25464's own: every decided case of 65,940 generated formats matches, behaviour it can't confirm shows `?`, and formats that would freeze WACUP are flagged instead of run.
- Hovers corrected against the real engines: WACUP 1.99.43 and 1.99.57, and now Winamp 5.666 and 5.9.2 too (which behave identically). Among them: `$pad` repeats the whole fill string, `$len`/`$left`/`$cut`/`$right` count UTF-16 code units, `$right` with n past the end gives nothing, `$substr` units and its ignored 4th argument, `$abbr` keeps punctuation and Roman numerals, `$trim` strips all whitespace, `$caps` doesn't break words at apostrophes, `$decode`/`$ifstrequal` fold ASCII case only, `$puts` with an empty value doesn't overwrite, `systime_*` values aren't zero-padded, and many Winamp 5 differences. Where Winamp 5 **crashes** rather than freezes (an empty `$replace` search, empty arguments to `$trim`, `$pad`, `$strchr` and others), the hover now says so.
- `$strstr`, the `$strchr` family and `$num`/`$dec`/`$hex` take exactly 2 arguments, `$muldiv` exactly 3: more now gets `arity-max`.
- `always-true-condition` understands `$if($strstr(%title%,live),…)`: `$strstr` is empty when either argument is, otherwise a number, and `0` (not found) counts as true, so the condition only tests that `%title%` isn't empty. The warning now says so and suggests `$ifgreater($strstr(…),0,…)`. With two arguments that can't be empty it's the usual always-true warning. Winamp 5, which tests whether a field resolved, is unchanged.
- New rule `winamp-crash` (error, `winamp` dialect only): Winamp 5 passes empty arguments as NULL pointers, and crashes on an empty `$trim()` argument, `$pad`/`$lpad` pad string, `$padcut` custom argument, `$strchr`/`$strlchr`/`$strrchr` character, `$strrchr` string or `$split` token, and on an empty-able `$muldiv` argument. `$padcut` with a custom argument but no or an empty pad string divides by zero whenever it has to pad, and `$div`/`$mod(-2147483648,-1)` overflow. A field or call that can be empty gets "may crash". All checked on Winamp 5.666 and 5.9.2; functions with a maximum argument count give nothing, not a crash, when the count is wrong, so those aren't flagged.
- `winamp-crash` follows `$div`/`$mod`'s running value over literal arguments, so `$div(-2147483648,1,-1)` and `$div(-2147483648,0,-1)` (a 0 divisor is skipped) are flagged too, and so is `$div(-9999999999,-1)` (out-of-range numbers are clamped to -2147483648). `$strstr` never makes an argument "may crash" under `winamp`, since Winamp 5 returns `0` from it even when an argument is empty. **Copy Format as Single Line** follows the `atf.dialect` setting: under `winamp` it warns when the format crashes Winamp 5 (or may, for some tracks) or freezes it. All checked on Winamp 5.666 and 5.9.2; WACUP is unchanged.
- New rule `name-too-long` (error, `wacup` dialect only): WACUP 1.99.57 rejects a `%field%` name longer than 32 characters (UTF-16 code units) with `[TRUNCATED FORMATTING STRING -> MISSING END TAG / WORKING BUFFER TOO SMALL]`, and a `$function(` name longer than 32 with `[SYNTAX ERROR IN FORMATTING STRING (4)]`. 32 is fine, and 1.99.43 and Winamp 5 accept any length. `$puts`/`$get` variable names have no such limit.
- Under the `winamp` dialect, lint messages describe Winamp 5: an empty `$replace` search (literal or computed) crashes it rather than freezing, an empty `$muldiv` argument crashes it (empty `$div`/`$mod` arguments do count as 0), and a wrong argument count prints `[INVALID $IF SYNTAX]` (`$if`, `$if2`, `$IfStrEqual*`), `[INVALID $IFLONGER SYNTAX]` or `[INVALID $IFGREATER SYNTAX]`.
- Syntax errors: WACUP shows `[SYNTAX ERROR IN FORMATTING STRING (n)]` only in place of the scope the error is in: the whole title at the top level, otherwise just that function argument or `[…]` section (so `a$upper(x(y))b` shows `a[SYNTAX ERROR…]b`). The lint message and settings description now say so.
- New freeze: a negative length makes `$padcut` never finish, so WACUP freezes, including the current 1.99.57.25464 (also 1.99.43.23234; checked against WACUP's own evaluator). The `negative-count` rule now flags `$padcut(a,-1)`, with no "Fixed in" build, and **Copy Format as Single Line** warns about it. A sweep of every other count argument with -1 found nothing else.
- On fixed builds the old freezes now return nothing: `$replace` with an empty search outputs an empty string (not the original text), and `$tab`/`$directory` with a negative count output nothing.

## 0.3.1 — 2026-11-08

- WACUP build notes from WACUP's developer ([#2](https://github.com/GhostPirateBob/atf-syntax/issues/2)): the `$replace` empty-search freeze is fixed in 1.99.56.25334, and the `$tab`/`$directory` negative-count freezes in 1.99.57.25452. Under the `wacup` dialect these lint messages now name the build; they stay errors, since older builds and Winamp 5 still freeze.
- Hovers: `$replace`'s case-insensitive 4th argument is 1.99.56+; from 1.99.55.25130 a negative n makes `$cut` cut that many characters off the end (`$cut(abcdef,-2)` → `abcd`); from 1.99.56.25334 a negative n makes `$left` output nothing, so it's no longer described as the same as `$cut`; `$filepart` left the period in on 1.99.54.24960.
- All of the above checked against WACUP's own evaluator on 1.99.57.25464, compared with 1.99.43.23234 (except the `$filepart` regression, which only affected 1.99.54).
- README: the technical reference moved to the [wiki](https://github.com/GhostPirateBob/atf-syntax/wiki).

## 0.3.0 — 2026-10-31

- Releases are immutable: once published, a release's tag and files can't be changed.
- Release notes say where to get the signing key.

## 0.2.9 — 2026-10-31

- GitHub releases have the `.vsix` and its signature attached again, as the same file published to the Marketplace. 0.2.8's release had neither.
- Build: GitHub Actions updated and pinned to commit hashes, Node 26, and stricter TypeScript checks.

## 0.2.8 — 2026-10-31

- Renamed to **ATF (Advanced Title Formatting)**, with a clearer description and more Marketplace keywords.
- README: a screenshot of a format running in WACUP's playlist, and examples highlighted as Lua, which looks better on the extension page.
- Hovers checked against WACUP's own evaluator, which corrects `$split` (`which` n returns everything after the n-th token), `$rating` (a non-zero `star_mode` means `*`, not the other way round), `$substr` (the third argument is a length), `$char` (not limited to the BMP), `$tab()` (outputs nothing) and `$pathrtrim` (unreliable), and documents `$select`, `$pathsafe`, `$bitdepth`, `$fileext`/`$ext` (upper-cased) and which comparisons ignore case.
- `$div` and `$mod` take any number of arguments, `$if3` needs only one, and the `$path*` functions default to 1 level, so these no longer get a false `arity-min` warning. `$split` with more than 3 arguments now gets `arity-max`.

## 0.2.7 — 2026-10-30

- Formats nested more than 128 levels deep are skipped with a `too-deep` warning instead of being parsed (very deep nesting used to take seconds, or overflow the stack).

## 0.2.6 — 2026-10-30

- New error rules for formats that **freeze WACUP**: `replace-empty-search` (`$replace(%album%,,)`) and `negative-count` (`$tab(-1)`, `$directory(path,-1)`); and a warning, `replace-search-may-be-empty`, for a `$replace` search made only of fields or calls.
- Copy Format as Single Line warns when the format would freeze WACUP.
- Hovers for `$replace`, `$tab` and `$directory` describe the freezes; `$tab` takes an optional count.

## 0.2.5 — 2026-10-30

- README: Install section with the Marketplace link and `code --install-extension gpb.atf-syntax`.

## 0.2.4 — 2026-10-30

- First Visual Studio Marketplace release, published from GitHub Actions with trusted publishing (no access tokens).
- Publisher ID is now `gpb`, so the extension ID is `gpb.atf-syntax`. If you installed an earlier `.vsix`, uninstall `GhostPirateBob.atf-syntax`.
- README: a screenshot, and `samples/winamp-playlist-titles.atf` as the one worked example.

## 0.2.3 — 2026-10-30

- Release `.vsix` files carry a GitHub build-provenance attestation and a GPG signature (`.asc`).
- CI runs the tests on Linux, Windows and macOS; the test command works on Node 22 (0.2.2's did not, so it was never published).
- Not published to the Marketplace: `package.json` named a publisher ID that doesn't exist. Fixed in 0.2.4.

## 0.2.1 — 2026-10-30

- Non-affiliation and trademark notice in the README and THIRD_PARTY_NOTICES.
- Source comments describe WACUP-compatible behaviour rather than implementation details; the compiled JavaScript ships without comments.
- MIT licence; repository, author, keywords, gallery banner and workspace-trust metadata for the Marketplace.

## 0.2.0 — 2026-10-30

- **Formatter**: Format Document wraps blocks at top-level boundaries without changing their output; `atf.format.lineWidth` (`0` = one line per block).
- **Copy Format as Single Line** command (editor context menu and Command Palette).
- New rule `empty-number`: empty numeric arguments such as `$left(%artist%,)`.
- Settings `atf.lint.enable` and `atf.lint.rules` (per-rule severity or `off`), with help text in the Settings UI.
- Hovers document WACUP changelog semantics for `$strbetween`, `$padout`/`$lpadout`, `$is_stream`, `$rating`, `$substr` and `$cut`, plus ten more fields.
- Linting is linear in the size of the input (a 1 MB string went from 4.2 s to 80 ms). Each document version is parsed once, shared by diagnostics, hovers and commands.
- `SyntaxErrorCode` enum, the `RULES` table and TSDoc throughout the source.
- New file and extension icons.

## 0.1.0 — 2026-10-30

- First version: TextMate grammar, a WACUP-compatible parser (error codes 2–9), lint rules, hovers and completion.
