<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createAtfEditor, type AtfEditor } from '@/lib/atfEditor'
import type { Origin } from '@/lib/docHistory'
import type { Finding } from '@/core'

/** `origin` is read once, at mount; after that the editor owns it (it follows undo and redo). */
const props = defineProps<{ doc: string; findings: Finding[]; origin?: Origin | null }>()
const emit = defineEmits<{ 'update:doc': [doc: string]; 'update:origin': [origin: Origin | null]; format: [] }>()

const host = ref<HTMLDivElement>()
let editor: AtfEditor | undefined

onMounted(() => {
  editor = createAtfEditor(host.value!, props.doc, (doc) => emit('update:doc', doc), {
    onFormat: () => emit('format'),
    origin: props.origin,
    onOrigin: (origin) => emit('update:origin', origin),
  })
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
  /** Replaces the whole format as one undo step, optionally with where it came from. */
  replace: (text: string, origin?: Origin | null) => editor?.setDoc(text, origin),
  undo: () => editor?.undo() ?? false,
  redo: () => editor?.redo() ?? false,
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
