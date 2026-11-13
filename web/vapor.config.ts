/**
 * Vue Vapor mode, opt-in: `npm run dev:vapor`, `npm run build:vapor` (into dist-vapor) and
 * `npm run serve:vapor` compile the components below with `<script setup vapor>`; every other
 * build is the normal one and contains no Vapor runtime at all (main.ts installs
 * vaporInteropPlugin only behind the compile-time __VAPOR__ constant).
 *
 * To try another component in Vapor mode, add its file name (in src/components) here; to take one
 * out, remove it. Its source doesn't change: vite.config.ts adds the `vapor` attribute to its
 * `<script setup>` while compiling in vapor mode. Check it in `npm run dev:vapor` (keys, ARIA,
 * transitions, slots, custom directives) before keeping it: see web/README.md.
 *
 * Each of these was checked in vapor mode against the normal build (same behaviour: keys, ARIA,
 * slots, v-show, the tag editor, paste and drop, the virtual list, the ticker's DOM and canvas
 * strips). None uses `v-tip` directly; their buttons that have one are VDOM components (IconButton).
 */
export const VAPOR_COMPONENTS: readonly string[] = [
  'DiagnosticsList.vue',
  'MiniPlaylist.vue',
  'SidebarSection.vue',
  'SongTicker.vue',
  'PartsTable.vue',
  'TrackList.vue',
]
