<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createAtfEditor, type AtfEditor } from '@/lib/atfEditor'
import type { Finding } from '@/core'

const props = defineProps<{ doc: string; findings: Finding[] }>()
const emit = defineEmits<{ 'update:doc': [doc: string]; format: [] }>()

const host = ref<HTMLDivElement>()
let editor: AtfEditor | undefined

onMounted(() => {
  editor = createAtfEditor(host.value!, props.doc, (doc) => emit('update:doc', doc), { onFormat: () => emit('format') })
  editor.setFindings(props.findings)
})
onBeforeUnmount(() => editor?.destroy())

watch(
  () => props.doc,
  (doc) => editor?.setDoc(doc),
)
watch(
  () => props.findings,
  (findings) => editor?.setFindings(findings),
)

defineExpose({
  insert: (text: string) => editor?.insert(text),
  select: (start: number, end: number) => editor?.selectFormatRange(start, end),
  focusRange: (range: { start: number; end: number } | null) => editor?.focusFormatRange(range),
  focus: () => editor?.view.focus(),
  rewrap: (next: string) => editor?.rewrap(next),
  charsPerLine: () => editor?.charsPerLine() ?? 0,
})
</script>

<template>
  <div ref="host" class="atf-editor" />
</template>

<style scoped>
.atf-editor {
  min-height: 3.2em;
}
</style>
