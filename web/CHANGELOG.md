# Playground changelog

Changes to the [ATF playground](https://ghostpiratebob.me/atf-syntax/). The extension has its own changelog: [../CHANGELOG.md](../CHANGELOG.md). The playground was first released with extension 0.5.0.

## 0.6.1 — 2026-11-14

### Faster

- **Tags are read in 2 to 4 background workers** (half your CPU cores), off the page. MediaInfo spends about 100 ms of solid work on each MP3 (walking its frames for the length and bitrate), which used to freeze typing and scrolling while a folder loaded. Importing 200 MP3s: **23.8 s → 8.3 s**, and 190 long tasks on the page → 1. A worker that crashes on a file is replaced and only that file fails.

### Install it as an app

- The playground can be **installed as an app** (a web app manifest with the extension's icon, maskable icons for Android, an Apple touch icon, and desktop and phone screenshots for the install dialog).
- **Works offline** after one visit: a small service worker keeps the page and the files it has loaded. Pages always come from the network when you're online, so you get the newest version.

### Small fixes

- On phones, **random recipe** is an icon, like format and reset beside it (the words stay for screen readers, with a tooltip).
- Every form field has a `name`, as Chrome's autofill check asks.
- The search waits for 2 characters before it searches (one shows your recent searches and a "keep typing" hint).
- Errors for each dialect are written to the browser console in full (`[WACUP]` / `[Winamp 5]`, rule and column), a second after you stop typing: the verdicts only count them.

### Tags from your files, matched to WACUP's fields

Checked against MediaInfo's output for 2,340 real MP3, M4A, Opus, FLAC and Ogg files, and against WACUP's documentation:

- `%tracknumber%` has no padding, as in WACUP: a file tagged `0125` shows `125`.
- `%disc%` shows the total too when the file has one, e.g. `1/2`.
- New: `%tool%` (the software that ripped or encoded the file), `%producer%`, `%director%` and `%type%` (`0` for audio, `1` for video).
- `%encoder%` now works for FLAC, Opus and Ogg files, and `%publisher%` falls back to a LABEL tag.

## 0.6.0 — 2026-11-14

### New

- **Song ticker mode.** The "Song tickers" recipe group turns the preview into a one-line Winamp-style ticker that scrolls one character at a time; the title shows once, with blank space after it, its start coming back in on the right as its end leaves on the left. It uses VT323 by default, or your own skin's bitmap ticker font (Winamp Modern player and shade presets), which stays in your browser only.
- **Show spaces**, on by default (cog menu → Display): every space in the format editor gets a dashed box, unusual ones (non-breaking, em, ideographic, tabs) included, so stray or doubled spaces in a format are easy to see.
- **Undo through format changes**: loading a recipe, a saved format or an .atf file, Start fresh and reset are each one undo step, and Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y work even when the editor doesn't have focus.
- A **format | reset** tab returns to the recipe, file or shared format you started from, with an Undo.
- The summary shows **both verdicts**, "WACUP will accept this" and "Winamp will accept this" (or the number of Winamp 5 errors, which jumps to the first).
- Your **last playlist is remembered** (tags, paths and cached titles only, never file contents), with a "Use samples" way back.
- Playlists of up to **5,000 tracks** (was 500), with a virtualised track list: Up/Down/Home/End move the selection.
- The **duration column** shows the track's `%length%`, the same value a format gets.
- A fifth sample track (Daft Punk, One More Time) and a 5-row playlist preview.
- **Tooltips** on the icon buttons, readable on keyboard focus and dismissable with Escape. The tagline is the logo's tooltip.
- Icons on every action button. On phones they show the icon alone.

### Faster

Measured in Chrome with the CPU slowed 4×:

- Startup JavaScript is **178 KB → 83 KB** gzipped. The editor (CodeMirror) loads after the page first paints, behind an identical static copy, and keys typed before it arrives are kept. The search palette, settings panel, tooltips and song ticker load when first needed.
- Typing with 2,000 tracks: **about 2.0–2.4 s → 120–140 ms** per keystroke. The evaluator keeps the playlist, results stream in by chunks (visible rows first), and the time limit is per track, so a big playlist is never mistaken for a format that would freeze WACUP.
- The first search opens in **about 50 ms** (was up to 0.8 s). Its index is built when the site is built, and it is warmed up when the page is idle.
- **No layout shift** while the page loads (was up to 0.29 on phones). The fonts are now served with the page instead of from Google Fonts, and preloaded.
- **Layout at startup: about 790 ms → 23 ms.** The header's shadow no longer reads the scroll position while the page mounts (an IntersectionObserver watches instead), and the severity marks and recipe symbols no longer send the browser looking through system fonts for missing glyphs.
- **Half the page's elements (about 1,100 → 550)**: collapsed sidebar sections no longer render their lists.
- Smaller fixes: instant list hovers, long work split into short tasks, and analytics loaded only once the page is idle.

### Look and accessibility

- Solarized palette throughout: syntax colours (magenta function names, green `$` and `%`, cyan brackets, violet numbers), severity icons (error, warning, info), layered dark backgrounds, rounded sidebar cards, themed scrollbars and zebra rows in the preview.
- Labelled landmarks. The logo link is named by its text. Text colours meet WCAG AA except a few deliberate Solarized choices, which are noted in the CSS.
- The page no longer scrolls sideways, and keeps the scrollbar's space so content doesn't shift.
- The "Taskbar thumbnail" recipe is now a one-line format.
- **Sidebar sections are accordions**: opening one closes the others in that tab (Saved stays open), and a first visit opens only the first. Opening a section scrolls it to the top, and a search result opens its section.
- Recipe notes fit in two lines.
- The header reads **atf-playground**.
- Web fonts use `font-display: auto` (a brief wait instead of a flash of a fallback font).
- A favicon that follows the browser's light or dark theme (`favicon.svg`, with `favicon.ico` and PNG fallbacks), and a `robots.txt`.
- Analytics use the plain Google tag only, outside the GDPR area.

### For developers

- `npm run serve:dist` builds and serves the production build on port 4174. `npm run dev:vapor` / `build:vapor` / `serve:vapor` try an opt-in Vue Vapor build (port 4180); the normal build contains no Vapor code. See [README.md](README.md).
- Source maps are separate `.map` files.
- The sample-track generator reads the music folder from `ATF_SAMPLE_MUSIC`.
