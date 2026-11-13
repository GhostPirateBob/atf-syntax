```sh
npm install
npm test            # TypeScript build + node --test (parser, linter, formatter, settings schema)
npm run package     # → atf-syntax-<version>.vsix
code --install-extension atf-syntax-<version>.vsix
```

**F5** opens an Extension Development Host on `samples/`.
