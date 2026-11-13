In ATF every space is output, so there's no indenting or re-spacing. **Format Document** only changes *where a block is split into lines*: it breaks between top-level constructs (`$calls`, `[sections]`, `%fields%`, `'literals'` and text runs) to fit `atf.format.lineWidth`, like the Abbreviated format in the [README](https://github.com/GhostPirateBob/atf-syntax#atf-files). A break is never made:

- next to a space, because editors trim trailing whitespace on save;
- where the next line would start with `#` and become a comment;
- in a block with a syntax error, which is left exactly as written.

The tests check that joining the formatted lines gives back the original string, for the sample file and thousands of random formats, and that formatting twice changes nothing. `"atf.format.lineWidth": 0` joins every block onto one line.
