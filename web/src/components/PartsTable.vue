<script setup lang="ts">
import { computed } from 'vue'
import { FIELD_MAP, FUNCTION_MAP, REMOVED, topLevelItems, type ParseResult } from '@/core'
import { inlineMarkdown } from '@/lib/markdown'
import HighlightedFormat from './HighlightedFormat.vue'

const props = defineProps<{ format: string; parsed: ParseResult }>()
const emit = defineEmits<{ hover: [range: { start: number; end: number } | null]; pick: [range: { start: number; end: number }] }>()

interface Part {
  start: number
  end: number
  text: string
  label: string
  meaning: string
}

/** Each top-level piece of the format, explained the way crontab.guru explains a cron field. */
const parts = computed<Part[]>(() => {
  if (!props.format || props.parsed.error || props.parsed.tooDeep) return []
  return topLevelItems(props.format, props.parsed).map((span) => {
    const text = props.format.slice(span.start, span.end)
    return { ...span, text, ...describe(text) }
  })
})

function describe(text: string): { label: string; meaning: string } {
  if (text.startsWith('%') && text.endsWith('%') && text.length > 1 && text !== '%%') {
    const name = text.slice(1, -1).toLowerCase()
    const info = FIELD_MAP.get(name)
    return { label: name, meaning: info ? inlineMarkdown(info.doc) : 'A tag field WACUP doesn\'t list. An input plugin may still provide it; otherwise it\'s empty.' }
  }
  if (text.startsWith('$') && text.includes('(') && !text.startsWith('$$')) {
    const name = text.slice(1, text.indexOf('(')).toLowerCase()
    const info = FUNCTION_MAP.get(name)
    if (info) return { label: `$${name}`, meaning: `<code>$${name}${info.sig}</code> ${inlineMarkdown(info.doc)}` }
    return { label: `$${name}`, meaning: REMOVED[name] ? inlineMarkdown(REMOVED[name]) : 'Not a WACUP function: WACUP prints <code>[UNKNOWN FUNCTION]</code> here.' }
  }
  if (text.startsWith('[')) return { label: '[ … ]', meaning: 'Shown only if a <code>%field%</code> inside it has a value.' }
  if (text.startsWith("'") && text !== "''") return { label: "' … '", meaning: 'Quoted text, shown exactly as written.' }
  return { label: 'text', meaning: 'Shown as written. Spaces count.' }
}
</script>

<template>
  <div v-if="parts.length" class="parts">
    <nav class="chips">
      <button
        v-for="(p, i) in parts"
        :key="i"
        class="chip"
        @mouseenter="emit('hover', p)"
        @mouseleave="emit('hover', null)"
        @focus="emit('hover', p)"
        @blur="emit('hover', null)"
        @click="emit('pick', p)"
      >
        {{ p.label }}
      </button>
    </nav>
    <table>
      <tbody>
        <tr v-for="(p, i) in parts" :key="i" @mouseenter="emit('hover', p)" @mouseleave="emit('hover', null)" @click="emit('pick', p)">
          <td class="snippet"><HighlightedFormat :format="p.text" /></td>
          <td class="meaning" v-html="p.meaning" />
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.parts {
  margin: 18px auto 0;
  max-width: 820px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 18px;
  margin-bottom: 14px;
}
.chip {
  background: none;
  border: none;
  padding: 2px 0;
  color: var(--text);
  text-decoration: underline;
  text-underline-offset: 4px;
  font-family: var(--mono);
}
.chip:hover,
.chip:focus-visible {
  color: var(--gold);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.93rem;
}
tr {
  border-top: 1px solid var(--border);
  cursor: pointer;
}
tr:last-child {
  border-bottom: 1px solid var(--border);
}
tr:hover {
  background: rgba(7, 54, 66, 0.45);
}
td {
  padding: 5px 10px;
  vertical-align: top;
}
.snippet {
  width: 40%;
  text-align: right;
  font-family: var(--mono);
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snippet :deep(.hl) {
  white-space: nowrap;
}
.meaning {
  color: var(--text);
}
</style>
