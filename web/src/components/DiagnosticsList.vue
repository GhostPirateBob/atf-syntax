<script setup lang="ts">
import { computed } from 'vue'
import type { Finding } from '@/core'

/**
 * `findings` are in the dialect chosen in settings; `accept` holds each dialect's error-severity
 * findings, for the line saying which of WACUP and Winamp 5 will take the format.
 */
const props = defineProps<{ findings: Finding[]; accept: { wacup: Finding[]; winamp: Finding[] } }>()
const emit = defineEmits<{ pick: [range: { start: number; end: number }] }>()

const counts = computed(() => {
  const c = { error: 0, warning: 0, info: 0, hint: 0 }
  for (const f of props.findings) c[f.severity]++
  return c
})
const icon = { error: '●', warning: '▲', info: '◆', hint: '·' } as const
const verdicts = computed(() => [
  { key: 'wacup', ok: 'WACUP will accept this', name: 'WACUP', errors: props.accept.wacup },
  { key: 'winamp', ok: 'Winamp will accept this', name: 'Winamp 5', errors: props.accept.winamp },
])
const plural = (n: number) => `${n} error${n === 1 ? '' : 's'}`
</script>

<template>
  <section class="diag" aria-live="polite">
    <p class="lights">
      <span :class="counts.error ? 'sev-error' : 'muted'">● {{ counts.error }} error{{ counts.error === 1 ? '' : 's' }}</span>
      <span :class="counts.warning ? 'sev-warning' : 'muted'">▲ {{ counts.warning }} warning{{ counts.warning === 1 ? '' : 's' }}</span>
      <span :class="counts.info + counts.hint ? 'sev-info' : 'muted'">◆ {{ counts.info + counts.hint }} note{{ counts.info + counts.hint === 1 ? '' : 's' }}</span>
      <span class="verdicts">
        <template v-for="v in verdicts" :key="v.key">
          <span v-if="!v.errors.length" class="verdict ok"><span class="tick" aria-hidden="true">✓</span> {{ v.ok }}</span>
          <!-- The first error's message is the tooltip; a click selects it in the editor. -->
          <button v-else class="verdict bad" :title="v.errors[0]!.message" @click="emit('pick', v.errors[0]!)">
            <span aria-hidden="true">✗</span> {{ v.name }}: {{ plural(v.errors.length) }}
          </button>
        </template>
      </span>
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
  gap: 4px 18px;
  margin: 0;
  font-size: 0.88rem;
}
/* The two verdicts stay together, and wrap onto a line of their own when the counts fill it. */
.verdicts {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 18px;
}
.verdict {
  white-space: nowrap;
}
.ok {
  color: var(--accept-text);
}
.tick {
  color: var(--accept-icon);
}
.bad {
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: none;
  color: var(--error);
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.bad:hover,
.bad:focus-visible {
  color: var(--error);
  text-decoration-style: solid;
}
.bad:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 2px;
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
