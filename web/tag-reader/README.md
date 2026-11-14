# Tag reader

The playground reads the tags of dropped audio files with this Rust crate, compiled to
WebAssembly: audio or video file in, MediaInfo-style JSON out (the JSON `src/lib/mediainfo.ts`
turns into ATF tags). `src/abi.rs` is the plain C ABI that `src/lib/vuio.ts` calls from the tag
worker.

```bash
rustup target add wasm32-unknown-unknown
npm run build:wasm        # from web/: builds and copies src/wasm/vuio_media_info.wasm + LICENSES.txt
cargo test                # from here: the Rust tests (vitest covers the .wasm itself)
```

The built `.wasm` is committed, so building the playground needs no Rust; rebuild it after
changing anything here.

## Where it came from

A copy of [vuio-media-info](https://github.com/vuiodev/vuio-media-info), branch
`strip-json-only-wasm-for-atf-syntax` (cut down from main at `ce83e9d` to the JSON tag reader),
with its `wasm/` crate folded in as `src/abi.rs`. The only other differences: no CLI, and no
`inspect(path)` (so no memmap2). To take changes from there, copy `src/{audio,container,core,
tags,video,json.rs}` and `tests/` over these.

MIT OR Apache-2.0 (LICENSE-MIT, LICENSE-APACHE). Parts are based on MediaInfoLib by
MediaArea.net SARL, BSD-2-Clause: see NOTICE.
