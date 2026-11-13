<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'

/**
 * A sidebar group with a heading that collapses it. The list shows or hides at once (no height
 * animation); `entering` is set just after an expand, so its items fade and drop in.
 */
defineProps<{ id: string; title: string; count?: number; expanded: boolean; entering?: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <section class="sb-section">
    <h3 class="sb-head">
      <button :id="`${id}-btn`" class="sb-toggle" :aria-expanded="expanded" :aria-controls="`${id}-list`" @click="$emit('toggle')">
        <span class="sb-title">{{ title }}</span>
        <span v-if="count !== undefined" class="sb-count">· {{ count }}</span>
        <ChevronDown :size="16" aria-hidden="true" class="sb-chev" />
      </button>
    </h3>
    <div v-show="expanded" :id="`${id}-list`" class="sb-list" :class="{ entering }">
      <slot />
    </div>
  </section>
</template>

<!-- Not scoped: the entrance applies to the slotted items, which carry SideBar's scope. -->
<style>
.sb-section {
  border-top: 1px solid var(--border);
}
.sb-section:first-child {
  border-top: 0;
}
.sb-head {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
}
.sb-toggle {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 8px;
  border: 0;
  border-radius: 0;
  background: rgba(var(--sb-head-tint-rgb), 0.12);
  color: var(--text);
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
/* Hover tint: an overlay that fades in (opacity only), per the motion rule in style.css. */
.sb-toggle::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: rgba(var(--tint-rgb), 0.35);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}
.sb-toggle:hover::before {
  opacity: 1;
}
.sb-toggle:hover,
.sb-toggle:focus-visible {
  color: var(--bright);
}
.sb-toggle:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: -2px;
}
.sb-count {
  color: var(--muted-raised);
  font-weight: normal;
  letter-spacing: normal;
}
.sb-chev {
  flex: none;
  margin-left: auto;
  color: var(--muted-raised);
  transition: transform calc(0.18s * var(--motion)) ease-out;
}
/* Pointing down: tap to show. Turned up while the items show. */
.sb-toggle[aria-expanded='true'] .sb-chev {
  transform: rotate(180deg);
}
/* The list sits on its own surface (--sb-list-bg in style.css), and each section's items on it
   form one card (--recipe-bg) with rounded outer corners: the first item's top corners and the
   last item's bottom ones. */
.sb-list {
  padding: 4px 0 10px;
  background: var(--sb-list-bg);
  /* Secondary text, rules between items and the hover tint, retuned for the list's surface. */
  --muted: var(--muted-raised);
  --dim: var(--muted-raised);
  --border: var(--sb-rule);
  --tint-rgb: var(--sb-tint-rgb);
}
.sb-section .sb-list > * {
  background: var(--recipe-bg);
}
.sb-section .sb-list > :first-child {
  border-top-left-radius: var(--radius-sm);
  border-top-right-radius: var(--radius-sm);
}
.sb-section .sb-list > :last-child {
  border-bottom-left-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}
/* Just expanded: the items fade and drop 4 px into place, staggered by 10 ms (60 ms at most). With
   less motion, --motion is 0, so they only fade. */
.sb-list.entering > * {
  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out;
}
@starting-style {
  .sb-list.entering > * {
    opacity: 0;
    transform: translate3d(0, calc(-4px * var(--motion)), 0);
  }
}
.sb-list.entering > :nth-child(2) {
  transition-delay: 10ms;
}
.sb-list.entering > :nth-child(3) {
  transition-delay: 20ms;
}
.sb-list.entering > :nth-child(4) {
  transition-delay: 30ms;
}
.sb-list.entering > :nth-child(5) {
  transition-delay: 40ms;
}
.sb-list.entering > :nth-child(6) {
  transition-delay: 50ms;
}
.sb-list.entering > :nth-child(n + 7) {
  transition-delay: 60ms;
}
</style>
