<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown } from '@lucide/vue'

/**
 * A sidebar group with a heading that collapses it. The list shows or hides at once (no height
 * animation); `entering` is set just after an expand, so its items fade and drop in.
 */
const props = defineProps<{ id: string; title: string; count?: number; expanded: boolean; entering?: boolean }>()
defineEmits<{ toggle: [] }>()

/**
 * The section's height until the browser has laid it out once (see content-visibility below): the
 * heading, plus about 120 px a card when open (measured: 85 to 170). Once laid out, the browser
 * remembers the real height (`auto`), so the sidebar's scrollbar doesn't jump.
 */
const estimate = computed(() => `auto ${props.expanded ? 40 + 120 * (props.count ?? 3) : 40}px`)
</script>

<template>
  <section class="sb-section" :aria-labelledby="`${id}-title`" :style="{ containIntrinsicSize: estimate }">
    <h3 class="sb-head">
      <button :id="`${id}-btn`" class="sb-toggle" :aria-expanded="expanded" :aria-controls="`${id}-list`" @click="$emit('toggle')">
        <span :id="`${id}-title`" class="sb-title">{{ title }}</span>
        <span v-if="count !== undefined" class="sb-count">· {{ count }}</span>
        <ChevronDown :size="16" aria-hidden="true" class="sb-chev" />
      </button>
    </h3>
    <!-- The wrapper always exists (the heading's aria-controls names it); its items render only
         while open, so a collapsed section costs one empty element, not its whole list. -->
    <div v-show="expanded" :id="`${id}-list`" class="sb-list" :class="{ entering }">
      <div v-if="expanded" class="sb-card"><slot /></div>
    </div>
  </section>
</template>

<!-- Not scoped: the entrance applies to the slotted items, which carry SideBar's scope. -->
<style>
.sb-section {
  /* Sections scrolled out of the sidebar's view skip layout and paint until they come near it (the
     sidebar is most of the page's DOM). Search, focus, find-in-page and scrollIntoView still reach
     them. The size it assumes until then is set in script. */
  content-visibility: auto;
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
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 8px;
  border: 0;
  border-radius: 0;
  /* The heading tint (12 %) over the sidebar, as the solid colour it gives. */
  background: color-mix(in srgb, rgb(var(--sb-head-tint-rgb)) 12%, var(--chrome-bg));
  color: var(--text);
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
/* Hover tint, instant like every list item's (see the motion rule in style.css): 35 % tint over the
   heading's colour, solid. */
.sb-toggle:hover {
  background: color-mix(in srgb, rgb(var(--tint-rgb)) 35%, color-mix(in srgb, rgb(var(--sb-head-tint-rgb)) 12%, var(--chrome-bg)));
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
/* Each section's items form one card on the sidebar: they rest on --sb-list-bg (style.css), and
   the card (.sb-card) takes the spacing and the rounded corners, which the first item's top
   corners and the last item's bottom ones follow, so edges and corners line up exactly. */
.sb-list {
  /* Secondary text, rules between items and the hover tint, retuned for the list's surface. */
  --muted: var(--sb-muted);
  --dim: var(--sb-muted);
  --border: var(--sb-rule);
  --tint-rgb: var(--sb-tint-rgb);
  /* Token colours that read at 4.5:1 on the cards, hovered or not (see --sb-magenta in style.css). */
  --magenta: var(--sb-magenta);
  --gold: var(--sb-gold);
  --blue: var(--sb-blue);
  --cyan: var(--sb-cyan);
  --red: var(--sb-red);
  --orange: var(--sb-orange);
  --comment: var(--sb-comment);
  --error-text: var(--sb-error-text);
  --warning-text: var(--sb-warning-text);
}
.sb-card {
  margin: 4px 0 10px;
  border-radius: var(--radius-sm);
  overflow: clip;
}
.sb-section > .sb-list > .sb-card > * {
  background: var(--sb-list-bg);
}
.sb-section > .sb-list > .sb-card > :first-child {
  border-top-left-radius: var(--radius-sm);
  border-top-right-radius: var(--radius-sm);
}
.sb-section > .sb-list > .sb-card > :last-child {
  border-bottom-left-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}
/* Just expanded: the items fade and drop 4 px into place, staggered by 10 ms (60 ms at most). With
   less motion, --motion is 0, so they only fade. */
.sb-list.entering .sb-card > * {
  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out;
}
@starting-style {
  .sb-list.entering .sb-card > * {
    opacity: 0;
    transform: translate3d(0, calc(-4px * var(--motion)), 0);
  }
}
.sb-list.entering .sb-card > :nth-child(2) {
  transition-delay: 10ms;
}
.sb-list.entering .sb-card > :nth-child(3) {
  transition-delay: 20ms;
}
.sb-list.entering .sb-card > :nth-child(4) {
  transition-delay: 30ms;
}
.sb-list.entering .sb-card > :nth-child(5) {
  transition-delay: 40ms;
}
.sb-list.entering .sb-card > :nth-child(6) {
  transition-delay: 50ms;
}
.sb-list.entering .sb-card > :nth-child(n + 7) {
  transition-delay: 60ms;
}
</style>
