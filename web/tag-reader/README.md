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
with its `wasm/` crate folded in as `src/abi.rs`. Differences from upstream: no CLI; no
`inspect(path)` (so no memmap2); and **no video-codec-detail parsing** — `src/video/` (the AVC /
HEVC / MPEG-2 SPS parsers) is removed and the four container modules + `lib.rs` drop the SPS
enrichment, keeping only container-level video-track detection (all `%type%` needs). That saved
~74 KB (20 %) off the `.wasm`; the playground never showed the dropped detail (resolution, codec
profile, colour). To take changes from there, copy `src/{audio,container,core,tags,json.rs}` and
`tests/` over these — **not** `src/video/`, and re-apply the SPS removal in the container modules
afterwards (`git show` the trim commit for the diff).

MIT OR Apache-2.0 (LICENSE-MIT, LICENSE-APACHE). Parts are based on MediaInfoLib by
MediaArea.net SARL, BSD-2-Clause: see NOTICE.
