The parser follows WACUP's algorithm: one pass, where each call re-scans its own extent. Measured on Node 26:

| Input | Lint time |
|---|---|
| a typical 365-character format | ~45 µs |
| a 2 KB `.atf` file | ~0.2 ms |
| a 4.5 MB file (56,000 lines) | ~0.5 s |
| one 1 MB format string | ~80 ms |
| nesting 128 levels deep (the limit; real formats nest under 10) | ~5 ms |
| anything deeper | skipped with a `too-deep` warning |

Diagnostics are debounced while typing, and each document version is parsed once and shared by diagnostics, hovers and the copy command.
