<script setup lang="ts">
import { computed } from 'vue'
import { Moon, Sun } from '@lucide/vue'
import { setTheme, theme } from '@/lib/theme'

const next = computed(() => (theme.value === 'dark' ? 'light' : 'dark'))
</script>

<template>
  <button class="theme-toggle" :aria-label="`Switch to ${next} theme`" :title="`Switch to ${next} theme`" @click="setTheme(next)">
    <!-- A sun in the dark theme (switch to light), a moon in the light theme. -->
    <Sun v-if="theme === 'dark'" :size="18" aria-hidden="true" />
    <Moon v-else :size="18" aria-hidden="true" />
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
