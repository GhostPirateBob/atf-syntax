<script setup lang="ts">
import { computed } from 'vue'
import { SPACE_CLASS, splitSpaces } from '@/lib/whitespace'

/**
 * A rendered title, with each space outlined when `spaces` is on (Settings: Show spaces). The text
 * is the same either way: the outlines are CSS, so widths and screen readers are unaffected.
 */
const props = defineProps<{ text: string; spaces: boolean }>()
const segments = computed(() => (props.spaces ? splitSpaces(props.text) : []))
</script>

<template>
  <template v-if="spaces"
    ><template v-for="(s, i) in segments" :key="i"
      ><template v-if="s.kind === 'text'">{{ s.text }}</template
      ><span v-else :class="SPACE_CLASS[s.kind]" :title="s.name">{{ s.text }}</span></template
    ></template
  ><template v-else>{{ text }}</template>
</template>
