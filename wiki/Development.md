```sh
npm install
npm test            # TypeScript build + node --test (parser, linter, formatter, evaluator, settings schema, wiki)
npm run package     # → atf-syntax-<version>.vsix
code --install-extension atf-syntax-<version>.vsix
```

**F5** opens an Extension Development Host on `samples/`.

## Web playground

The [playground](https://ghostpiratebob.me/atf-syntax/) and the [extension docs page](https://ghostpiratebob.me/atf-syntax/extension/) live in `web/` (Vue and Vite). They use the extension's own parser, linter, formatter and catalogue from `src/`, so they can't drift from it. `web/` has its own `package.json`, so install it separately:

```sh
cd web && npm install && cd ..
npm run dev            # at the root: forwards to web/ and opens the playground

cd web
npx vitest run         # web tests
npx vue-tsc --build    # type check
npx vite build         # → web/dist
```

## Workflows

- **CI** (`ci.yml`): builds, tests and packages the extension on Windows, macOS and Linux, on every push to `main` and every pull request.
- **Pages** (`pages.yml`): tests, type-checks and builds `web/`, then deploys it to GitHub Pages. It deploys on each published release, on pushes to `main` that touch `web/`, `src/` or `package.json`, and on demand. Pull requests only build.
- **Wiki** (`wiki.yml`): the repo's `wiki/` folder is the source of this wiki. When it changes on `main`, the workflow copies `wiki/*.md` to the GitHub wiki, so edits made in the wiki's web editor are overwritten. Edit the files in the repo instead.
- **Publish** (`publish.yml`): a `v*` tag builds the `.vsix`, creates a draft GitHub release and publishes to the Marketplace.

## Generated files

Don't edit these by hand; re-run the script instead.

| File | Generated from | Command |
|---|---|---|
| `wiki/Lint-Rules.md` | `RULES` in `src/lint.ts` | `npm run compile && node scripts/wiki-lint-rules.js` (`test/wiki.test.js` fails if it's out of date) |
| `web/public/third-party-notices.txt` | the packages in the built site | `node scripts/make-third-party-notices.mjs`, from `web/`, after changing dependencies |
| `web/src/lib/sample-mediainfo.json` | mediainfo's output for the sample tracks | `python -I web/scripts/make-sample-mediainfo.py` (needs the mediainfo CLI and the author's music files) |

Hovers, lint rules and the playground's evaluator were checked against the real engines with an oracle harness that runs WACUP's and Winamp 5's own title formatting code. It lives outside the repo and isn't needed to build.
