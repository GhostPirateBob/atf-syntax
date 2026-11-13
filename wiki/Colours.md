The grammar uses standard TextMate scopes, so every theme colours it. To fine-tune, these are the ATF-specific scopes:

| Token | Scope |
|---|---|
| `$` of a call | `punctuation.definition.function.atf` |
| `$if` `$if2` `$iflonger` `$decode` `$select`… | `keyword.control.conditional.atf` |
| `$puts` `$put` `$get` / variable name | `storage.type.variable.atf` / `variable.other.readwrite.atf` |
| other functions | `entity.name.function.atf` |
| `%field%` / its `%` | `variable.other.field.atf` / `punctuation.definition.variable.begin.atf`, `….end.atf` |
| `'literal'` | `string.quoted.single.atf` |
| `%%` `$$` `''` | `constant.character.escape.atf` |
| `[` `]` | `keyword.other.conditional.begin.atf` / `keyword.other.conditional.end.atf` |
| integer argument | `constant.numeric.integer.atf` |
| bare `(` `)` `]` | `invalid.illegal.bare-bracket.atf` (`invalid.illegal.bare-paren.atf` for `(` `)` inside a call or `[…]`) |
| `#` comment line in a `.atf` file | `comment.line.number-sign.atf` |

For example, a gold `$` sigil:

```jsonc
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "punctuation.definition.function.atf", "settings": { "foreground": "#be9208", "fontStyle": "bold" } }
  ]
}
```

**Material Icon Theme** doesn't use icons that extensions contribute for their languages. To get the ATF file icon there, put [`images/atf-dark.svg`](https://github.com/GhostPirateBob/atf-syntax/blob/HEAD/images/atf-dark.svg) in your `.vscode/extensions/icons/` folder as `atf.svg`, then add:

```jsonc
"material-icon-theme.files.associations": { "*.atf": "../../icons/atf" }
```

Material caches a copy as `atf~<hash>.svg`; if you later change the SVG, toggle any Material setting so it copies it again.
