# ATF playground (web)

The live playground and the extension's docs page, built with Vue 3.6 and Vite. Run the scripts
from this folder.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server (Vite, opens the browser). |
| `npm run build` | Production build into `dist/` (what GitHub Pages deploys). |
| `npm run preview:dist` | Serves `dist/` on <http://127.0.0.1:4174/> (no build). |
| `npm run serve:dist` | `build`, then `preview:dist`: the setup the performance tests use. |
| `npm run type-check` | `vue-tsc --build`. |
| `npm test` | Vitest. |

## Vue Vapor mode (opt-in)

Vapor is Vue 3.6's compiler mode without a virtual DOM. Here it's an experiment you can switch on
for some components; the normal build doesn't change and contains no Vapor code.

| Script | What it does |
| --- | --- |
| `npm run dev:vapor` | Dev server in vapor mode. |
| `npm run build:vapor` | Vapor build into `dist-vapor/` (never `dist/`; not deployed, git-ignored). |
| `npm run preview:vapor` | Serves `dist-vapor/` on <http://127.0.0.1:4180/> (no build). |
| `npm run serve:vapor` | `build:vapor`, then `preview:vapor`. |

The components compiled as Vapor are listed in [`vapor.config.ts`](vapor.config.ts). To try
another, add its file name there (sources stay as they are: in vapor mode, `vite.config.ts` adds
`vapor` to its `<script setup>`). Then check it in `npm run dev:vapor`: keyboard, ARIA, slots,
transitions and custom directives (`v-tip` is written for the virtual DOM, so a component that
uses it directly needs it adapted first). In vapor mode, `main.ts` installs `vaporInteropPlugin`
so Vapor and normal components can sit inside each other; it's behind the compile-time constant
`__VAPOR__`, which is `false` in every other build.

Vapor costs about 42 KB gzip more JavaScript at startup (its runtime and the interop layer), so it
only pays off where rendering, not layout or download, is the bottleneck.
