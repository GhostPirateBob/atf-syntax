<script setup lang="ts">
import { computed } from 'vue'
import type { Finding } from '@/core'

const props = defineProps<{ findings: Finding[] }>()
const emit = defineEmits<{ pick: [range: { start: number; end: number }] }>()

const counts = computed(() => {
  const c = { error: 0, warning: 0, info: 0, hint: 0 }
  for (const f of props.findings) c[f.severity]++
  return c
})
const icon = { error: '●', warning: '▲', info: '◆', hint: '·' } as const
</script>

<template>
  <section class="diag" aria-live="polite">
    <p class="lights">
      <span :class="counts.error ? 'sev-error' : 'muted'">● {{ counts.error }} error{{ counts.error === 1 ? '' : 's' }}</span>
      <span :class="counts.warning ? 'sev-warning' : 'muted'">▲ {{ counts.warning }} warning{{ counts.warning === 1 ? '' : 's' }}</span>
      <span :class="counts.info + counts.hint ? 'sev-info' : 'muted'">◆ {{ counts.info + counts.hint }} note{{ counts.info + counts.hint === 1 ? '' : 's' }}</span>
      <span v-if="!findings.length" class="ok">✓ WACUP will accept this</span>
    </p>
    <ul v-if="findings.length">
      <li v-for="(f, i) in findings" :key="i">
        <button class="finding" @click="emit('pick', f)">
          <span :class="`sev-${f.severity}`">{{ icon[f.severity] }}</span>
          <span class="msg">{{ f.message }}</span>
          <span class="rule mono">{{ f.rule }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.diag {
  max-width: 820px;
  margin: 10px auto 0;
}
.lights {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 18px;
  margin: 0;
  font-size: 0.88rem;
}
.ok {
  color: var(--green);
}
ul {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}
.finding {
  display: flex;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  padding: 3px 8px;
}
.finding:hover {
  border-left-color: var(--teal);
  background: rgba(var(--tint-rgb), 0.35);
}
.msg {
  flex: 1;
}
.rule {
  color: var(--muted);
  font-size: 0.8rem;
}
</style>
