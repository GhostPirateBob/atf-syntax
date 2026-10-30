# Changelog

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
