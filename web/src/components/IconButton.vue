<script setup lang="ts">
import type { Component } from 'vue'

/**
 * A button with an icon and a text label. Below `collapse` (narrow: 640 px, header: 1280 px) only
 * the icon shows; the label stays as the accessible name and the tooltip.
 */
withDefaults(defineProps<{ icon: Component; label: string; title?: string; collapse?: 'narrow' | 'header' | 'always'; showIcon?: boolean }>(), {
  title: undefined,
  collapse: 'narrow',
  showIcon: false,
})
</script>

<template>
  <button class="icon-btn" :class="[`collapse-${collapse}`, { 'show-icon': showIcon }]" :aria-label="label" :title="title ?? label">
    <component :is="icon" :size="16" aria-hidden="true" class="ico" />
    <span class="lbl">{{ label }}</span>
  </button>
</template>

<style scoped>
.icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
  flex: none;
}
.ico {
  flex: none;
}
/* Wide screens: the label says it all, so the icon is left out. */
.collapse-narrow:not(.show-icon) .ico,
.collapse-header:not(.show-icon) .ico {
  display: none;
}
.collapse-always .lbl {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.collapse-always {
  width: 34px;
  height: 32px;
  padding: 0;
}
@media (max-width: 1280px) {
  .collapse-header:not(.show-icon) .ico {
    display: block;
  }
  .collapse-header .lbl {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .collapse-header {
    width: 34px;
    height: 32px;
    padding: 0;
  }
}
@media (max-width: 640px) {
  .collapse-narrow:not(.show-icon) .ico {
    display: block;
  }
  .collapse-narrow .lbl {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .collapse-narrow {
    width: 34px;
    height: 32px;
    padding: 0;
  }
}
.icon-btn:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 1px;
}
</style>
