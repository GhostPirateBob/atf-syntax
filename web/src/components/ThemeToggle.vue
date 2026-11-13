<script setup lang="ts">
import { computed } from 'vue'
import { setTheme, theme } from '@/lib/theme'

const next = computed(() => (theme.value === 'dark' ? 'light' : 'dark'))
</script>

<template>
  <button class="theme-toggle" :aria-label="`Switch to ${next} theme`" :title="`Switch to ${next} theme`" @click="setTheme(next)">
    <!-- A sun in the dark theme (switch to light), a moon in the light theme. -->
    <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
    <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 32px;
  padding: 0;
}
.theme-toggle:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 1px;
}
</style>
