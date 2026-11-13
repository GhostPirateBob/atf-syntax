<script setup lang="ts">
import { computed } from 'vue'
import { tokenize } from '@/lib/tokens'

const props = defineProps<{ format: string }>()

const pieces = computed(() =>
  tokenize(props.format).map((t) => ({ text: props.format.slice(t.start, t.end), cls: t.kind === 'text' ? 'atf-text' : `tok-${t.kind}` })),
)
</script>

<template>
  <code class="hl"><span v-for="(p, i) in pieces" :key="i" :class="p.cls">{{ p.text }}</span></code>
</template>

<style scoped>
.hl {
  background: none;
  padding: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
