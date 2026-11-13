<script lang="ts">
import { ref } from 'vue'
/** Families from the Local Font Access API, kept while the page is open so reopening the panel keeps them. */
const localFamilies = ref<string[]>([])
</script>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { ViewSettings } from '@/lib/view'
import { ARIAL, FONT_GROUPS, singleFont } from '@/lib/fontStacks'
import { fontInstalled } from '@/lib/measure'

const model = defineModel<ViewSettings>({ required: true })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
onMounted(() => (panel.value?.querySelector<HTMLInputElement>('input:checked') ?? panel.value?.querySelector('input'))?.focus())

// Checked when the panel opens: a few dozen canvas measurements.
const groups = FONT_GROUPS.map((g) => ({
  label: g.label,
  fonts: g.fonts.map((name) => ({ name, installed: fontInstalled(name) })).sort((a, b) => Number(b.installed) - Number(a.installed)),
}))
const arialInstalled = fontInstalled(ARIAL)
/** A saved font that's in no list right now (e.g. picked from the installed list in an earlier visit). */
const orphan = computed(() => {
  const f = model.value.fontFamily
  return f && f !== ARIAL && !FONT_GROUPS.some((g) => g.fonts.includes(f)) && !localFamilies.value.includes(f) ? f : ''
})

type FontAccess = { queryLocalFonts?: () => Promise<{ family: string }[]> }
const canListFonts = typeof (window as FontAccess).queryLocalFonts === 'function'
async function listFonts() {
  try {
    const fonts = await (window as FontAccess).queryLocalFonts!()
    localFamilies.value = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
  } catch {
    /* permission denied or dismissed: the list just stays as it was */
  }
}
const label = (name: string, installed: boolean) => (installed ? name : `${name} (not installed)`)
</script>

<template>
  <div id="settings-panel" ref="panel" class="settings" role="region" aria-label="Settings" @keydown.esc.stop.prevent="emit('close')">
    <fieldset class="seg">
      <legend>Check for</legend>
      <label><input v-model="model.dialect" type="radio" name="dialect" value="wacup" /> WACUP</label>
      <label><input v-model="model.dialect" type="radio" name="dialect" value="winamp" /> Winamp 5</label>
    </fieldset>

    <fieldset>
      <legend>Playlist</legend>
      <label class="check"><input v-model="model.numbers" type="checkbox" /> Playlist numbers <span class="muted">(<code>1.</code> in front of each row)</span></label>
      <label class="check"><input v-model="model.duration" type="checkbox" /> Duration column <span class="muted">(the length on the right of each row)</span></label>
      <label class="line">
        <span class="name">Width</span>
        <input v-model.number="model.width" type="number" min="0" max="4000" step="10" /> px
        <span class="muted">0 = full width</span>
      </label>
      <label class="line">
        <span class="name">Font</span>
        <select v-model="model.fontFamily">
          <option value="" :style="{ fontFamily: singleFont('') }">Roboto Condensed (default)</option>
          <option :value="ARIAL" :style="{ fontFamily: singleFont(ARIAL) }">{{ label('Arial', arialInstalled) }} (classic Winamp)</option>
          <option v-if="orphan" :value="orphan" :style="{ fontFamily: singleFont(orphan) }">{{ orphan }}</option>
          <optgroup v-if="localFamilies.length" label="Installed on this computer">
            <option v-for="f in localFamilies" :key="f" :value="f" :style="{ fontFamily: singleFont(f) }">{{ f }}</option>
          </optgroup>
          <optgroup v-for="g in groups" :key="g.label" :label="g.label">
            <option v-for="f in g.fonts" :key="f.name" :value="f.name" :style="{ fontFamily: singleFont(f.name) }">{{ label(f.name, f.installed) }}</option>
          </optgroup>
        </select>
      </label>
      <label class="line">
        <span class="name">Typed font</span>
        <input v-model.trim="model.font" type="text" placeholder="Any installed font" />
      </label>
      <p v-if="canListFonts && !localFamilies.length" class="line list-fonts">
        <span class="name" />
        <button type="button" @click="listFonts">List my installed fonts…</button>
      </p>
      <label class="line">
        <span class="name">Size</span>
        <input v-model.number="model.fontSize" type="number" min="8" max="40" /> px
      </label>
      <p class="note muted">Widths are close to WACUP but not exact: Windows rounds each letter to whole pixels.</p>
    </fieldset>

    <fieldset>
      <legend>How WACUP shows titles</legend>
      <label class="check"><input v-model="model.trimLeading" type="checkbox" /> Trim leading whitespace <span class="muted">(start with a <code>.</code> to keep it)</span></label>
      <label class="check"><input v-model="model.underscoresToSpaces" type="checkbox" /> Underscores as spaces</label>
      <label class="check"><input v-model="model.pct20ToSpaces" type="checkbox" /> <code>%20</code> as spaces</label>
    </fieldset>

    <p class="note muted">A font you pick or type is only looked up on this computer; nothing is downloaded for it.</p>
  </div>
</template>

<style scoped>
/* A strip between the editor and the preview, so it covers neither while you type or adjust. */
.settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  align-items: start;
  gap: 10px 24px;
  max-width: 960px;
  margin: 2px auto 8px;
  padding: 10px 14px;
  background: var(--sidebar);
  border: 1px solid var(--teal);
  border-radius: 6px;
  text-align: left;
  font-size: 0.88rem;
}
.settings > .note {
  grid-column: 1 / -1;
}
fieldset {
  display: grid;
  gap: 4px;
  /* Not min-content: the font list's long group labels would widen the panel. */
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: none;
}
legend {
  padding: 0;
  margin-bottom: 2px;
  color: var(--bright);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
label {
  cursor: pointer;
}
/* Inline, so a muted hint wraps with its label instead of becoming a column. */
.check {
  display: block;
  padding-left: 22px;
  text-indent: -22px;
}
.check input {
  margin: 0 6px 0 3px;
  vertical-align: -2px;
}
.line {
  display: flex;
  gap: 6px;
  align-items: center;
}
.name {
  width: 74px;
  flex: none;
}
.line input[type='number'] {
  width: 76px;
}
.line input[type='text'],
.line select {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
}
select {
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 6px;
}
select:focus {
  outline: none;
  border-color: var(--teal);
}
input[type='checkbox']:focus-visible,
input[type='radio']:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 1px;
}
/* WACUP / Winamp 5 as a two-way switch. */
.seg {
  grid-template-columns: 1fr 1fr;
  gap: 0;
}
.seg legend {
  grid-column: 1 / -1;
}
.seg label {
  position: relative;
  text-align: center;
  padding: 3px 8px;
  border: 1px solid var(--border);
  background: var(--panel);
}
.seg label:first-of-type {
  border-radius: 4px 0 0 4px;
}
.seg label:last-of-type {
  border-radius: 0 4px 4px 0;
  border-left: none;
}
.seg input {
  position: absolute;
  opacity: 0;
  inset: 0;
  margin: 0;
  cursor: pointer;
}
.seg label:has(input:checked) {
  background: var(--teal);
  border-color: var(--teal);
  color: var(--on-accent);
}
.seg label:has(input:focus-visible) {
  outline: 2px solid var(--cyan);
  outline-offset: -2px;
}
.list-fonts {
  margin: 0;
}
.list-fonts button {
  font-size: 0.8rem;
  padding: 1px 8px;
}
.note {
  margin: 0;
  font-size: 0.78rem;
}
</style>
