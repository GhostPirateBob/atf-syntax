# ATF — Advanced Title Formatting for VS Code

Language support for **WACUP / Winamp Advanced Title Formatting** (ATF, a.k.a. *tagz*): the format strings behind playlist titles, the song ticker and the taskbar text, such as

<!-- GitHub has no ATF grammar. Fences use lua, the best match across GitHub, VS Code and other renderers, but # isn't a comment in lua and -- starts one, so keep both out of these blocks. -->
```lua
[%artist% ▸ ]$if2(%title%,$filepart(%filename%))
```

![A WACUP playlist with titles like Foals ▸ MN/B ▹ My Number, built by an ATF format](https://github.com/GhostPirateBob/atf-syntax/raw/HEAD/images/screenshot2.png)

*The Abbreviated format from [the sample file](#atf-files), running in WACUP's playlist.*

ATF is hard to debug inside the player. One stray character turns every title in the playlist into `[SYNTAX ERROR IN FORMATTING STRING (4)]` and gives no hint where it is. This extension's parser behaves like WACUP's, so it reports the same errors *and* points at the cause.

![samples/winamp-playlist-titles.atf highlighted in VS Code](https://github.com/GhostPirateBob/atf-syntax/raw/HEAD/images/screenshot.png)

## Install

From the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=gpb.atf-syntax), or:

```sh
code --install-extension gpb.atf-syntax
```

## Features

- **Highlighting**: fields, functions (control flow, variables and the rest are coloured separately), `'literals'`, the `%% $$ ''` escapes, `[conditional]` sections and integer arguments. Bare `(` `)` `]` are marked invalid.
- **WACUP-accurate errors**: the same error codes as WACUP, plus the culprit, e.g. *no balanced ')' for $puts( — unclosed '[' at column 61*. [All error codes](https://github.com/GhostPirateBob/atf-syntax/wiki/Error-Codes).
- **18 lint rules**: formats that freeze WACUP, unknown and removed functions, argument counts, empty numeric arguments, always-true/always-false `$if` conditions, `$get` before `$puts`, unknown fields, `[…]` with no field. Each rule's severity is configurable. [All rules](https://github.com/GhostPirateBob/atf-syntax/wiki/Lint-Rules).
- **Hovers and completion**: signatures and docs after `$`, the field list after `%`. They cover the documented functions and the undocumented WACUP extras (`$strbetween`, `$padout`, `$is_stream`, `$leftbracket()`…).
- **Lossless formatting**: wraps long formats onto several lines without changing their output. [How it works](https://github.com/GhostPirateBob/atf-syntax/wiki/Formatting).
- **Copy Format as Single Line**: puts the format at the cursor on the clipboard as one line, ready to paste into WACUP's preferences box.
- **Two dialects**: WACUP 1.99.x (default) and classic Winamp 5.

**Some formats freeze WACUP**, like an empty search in `$replace` or a negative count in `$tab`. The linter marks these as errors, and [the wiki explains why](https://github.com/GhostPirateBob/atf-syntax/wiki/Formats-That-Freeze-WACUP).

## `.atf` files

ATF itself has no comments or line breaks, so `.atf` files use a simple convention:

- a `#` in column 0 starts a comment line;
- a blank line separates formats;
- consecutive lines are **joined with nothing in between** into one format.

So you can keep a library of formats, with long ones split up for reading. These are the three formats in `samples/winamp-playlist-titles.atf`, the file in the screenshot. In the file, the name and example output above each one are `#` comments.

### Abbreviated (Artist ▸ Album ▹ Title/Filename)

`⇢  JAY-Z ▸ The Blueprint2 ▹ Blueprint2`

```lua
⇢  $puts(t,$if2(%title%,$filepart(%filename%)))$puts(araw,$if2(%albumartist%,%artist%))
$puts(fp,$strstr($replace($replace($lower($get(araw)),'(',' '),' ft',' feat'),' feat'))
$puts(a,$trim($ifgreater($get(fp),0,$left($get(araw),$sub($get(fp),1)),$get(araw))))
$if($get(a),$abbr($get(a),20) ▸ ,)[$abbr(%album%,18) ▹ ]
$iflonger($get(t),30,$left($get(t),29)…,$get(t))
```

### Default (Artist ▸ Title/Filename)

`JAY-Z ▸ Blueprint2`

```lua
[%artist% ▸ ]$if2(%title%,$filepart(%filename%))
```

### Basic (Artist ▸ Album ▹ Title/Filename)

`JAY-Z ▸ TheBlueprint2 ▹ Blueprint2`

```lua
$iflonger(%artist%,9,$left($replace(%artist%, ,),11),%artist%) ▸
$if(%album%, $iflonger(%album%,11,$left($replace(%album%, ,),13),%album%) ▹ , )
$if(%title%,$iflonger(%title%,11,$left($replace(%title%, ,),15),%title%),$left($filepart($replace(%filename%, ,)),15))
```

Each block is one format string. Hover anything for docs, then use **ATF: Copy Format as Single Line** (editor context menu or Command Palette) to paste it into WACUP.

To use the language for files with other names:

```jsonc
"files.associations": { "*-atf.pl": "atf" }
```

## Settings

| Setting | Default | |
|---|---|---|
| `atf.dialect` | `wacup` | `wacup` (1.99.x: `$if` tests for a non-empty string; extra functions) or `winamp` (classic 5.x: `$if` tests for resolved fields). |
| `atf.lint.enable` | `true` | Turn diagnostics off; everything else keeps working. |
| `atf.lint.rules` | `{}` | Per-rule severity: `"error"`, `"warning"`, `"info"`, `"hint"` or `"off"`, e.g. `{ "unknown-field": "off" }`. |
| `atf.format.lineWidth` | `100` | Wrap width for Format Document; `0` joins each block onto one line. |

## Known limitations

- The linter checks structure, not output. It doesn't evaluate formats, so it can't catch logic errors like a wrong `$left` length.
- The `%length%` unit depends on where the format is used (`m:ss` in the WACUP playlist, milliseconds in Winamp 5 and WACUP's taskbar text).
- Hovers and argument rules were checked by running formats through the evaluator in WACUP 1.99.43.23234, except `$rating` and `$bitdepth`, which need a running WACUP, so theirs come from reading its code. Notes that cite newer builds (such as `$replace`'s case-insensitive argument, b25266) come from the changelog.

## More

The [wiki](https://github.com/GhostPirateBob/atf-syntax/wiki) has the technical detail, including [token colours](https://github.com/GhostPirateBob/atf-syntax/wiki/Colours), [performance](https://github.com/GhostPirateBob/atf-syntax/wiki/Performance) and [building from source](https://github.com/GhostPirateBob/atf-syntax/wiki/Development).

The extension has no runtime dependencies beyond VS Code itself. See `THIRD_PARTY_NOTICES.md` for the icon attribution.

## Disclaimer

This is an independent project. It is not affiliated with, endorsed by or sponsored by WACUP or Winamp. WACUP and Winamp are trademarks of their respective owners and are named here only to describe compatibility.
