<script setup lang="ts">
export interface ViewSettings {
  trimLeading: boolean
  underscoresToSpaces: boolean
  pct20ToSpaces: boolean
  font: string
  fontSize: number
  width: number
  /** WACUP's "1. " playlist numbers in front of each row. */
  numbers: boolean
}

const model = defineModel<ViewSettings>({ required: true })
</script>

<template>
  <details class="display">
    <summary>Display: how WACUP shows titles <span class="muted">(not ATF)</span></summary>
    <div class="grid">
      <label><input v-model="model.trimLeading" type="checkbox" /> Trim leading whitespace <span class="muted">(WACUP drops it, even em spaces: start with a <code>.</code> instead)</span></label>
      <label><input v-model="model.underscoresToSpaces" type="checkbox" /> Show underscores as spaces</label>
      <label><input v-model="model.pct20ToSpaces" type="checkbox" /> Show <code>%20</code> as spaces</label>
      <label><input v-model="model.numbers" type="checkbox" /> Show playlist numbers <span class="muted">(<code>1. </code> in front of each row, as WACUP draws them)</span></label>
      <label class="row">
        Font
        <input v-model.trim="model.font" type="text" placeholder="Roboto Condensed (default), or a font installed on this computer" />
        <input v-model.number="model.fontSize" type="number" min="8" max="40" aria-label="Font size" /> px
      </label>
      <label class="row">
        Playlist width
        <input v-model.number="model.width" type="number" min="0" max="4000" step="10" aria-label="Playlist width in pixels" /> px
        <span class="muted">(0 = off; rows wider than this are marked)</span>
      </label>
      <p class="muted note">A font you type here is only looked up on your computer; nothing is downloaded for it. Widths are approximate: browsers draw text a little differently to WACUP.</p>
    </div>
  </details>
</template>

<style scoped>
.display {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 12px;
  background: var(--panel);
}
summary {
  cursor: pointer;
  color: var(--bright);
}
.grid {
  display: grid;
  gap: 6px;
  margin-top: 8px;
  font-size: 0.92rem;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.row input[type='text'] {
  flex: 1;
  min-width: 180px;
}
.row input[type='number'] {
  width: 80px;
}
.note {
  margin: 4px 0 0;
  font-size: 0.85rem;
}
</style>
