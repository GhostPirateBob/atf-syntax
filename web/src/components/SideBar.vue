<script setup lang="ts">
import { computed, ref } from 'vue'
import { FIELDS, FUNCTIONS } from '@/core'
import { inlineMarkdown } from '@/lib/markdown'
import { RECIPES, type Recipe } from '@/lib/recipes'
import HighlightedFormat from './HighlightedFormat.vue'

const emit = defineEmits<{ insert: [text: string]; load: [recipe: Recipe]; close: [] }>()

const tab = ref<'reference' | 'recipes'>('recipes')
const query = ref('')

const SYNTAX = [
  { code: '%artist%', doc: 'A tag field. Empty if the track has no such tag.' },
  { code: '$upper(%artist%)', doc: 'A function call. Arguments are worked out first, then the function runs.' },
  { code: '[ … ]', doc: 'Shown only if a `%field%` inside has a value: `[%artist% - ]%title%`.' },
  { code: "'text'", doc: "Literal text: use it for `, ( ) [ ] % $` in the output. `''` outputs one `'`." },
  { code: '%% $$', doc: 'A literal `%` or `$`.' },
  { code: '# …', doc: 'Playground only: a line starting with `#` is a comment. Line breaks are ignored, like in `.atf` files.' },
]

const q = computed(() => query.value.trim().toLowerCase())
const fields = computed(() => FIELDS.filter((f) => !q.value || f.name.includes(q.value) || f.doc.toLowerCase().includes(q.value)))
const functions = computed(() =>
  FUNCTIONS.filter((f) => !q.value || f.name.includes(q.value.replace(/^\$/, '')) || f.doc.toLowerCase().includes(q.value)),
)
const groups = computed(() => {
  const out = new Map<string, Recipe[]>()
  for (const r of RECIPES) out.set(r.group, [...(out.get(r.group) ?? []), r])
  return [...out]
})
</script>

<template>
  <aside class="sidebar">
    <header>
      <button :class="{ active: tab === 'recipes' }" @click="tab = 'recipes'">Recipes</button>
      <button :class="{ active: tab === 'reference' }" @click="tab = 'reference'">Reference</button>
      <span class="spacer" />
      <button class="close" aria-label="Close sidebar" @click="emit('close')">✕</button>
    </header>

    <div v-if="tab === 'recipes'" class="scroll">
      <p class="intro muted">Pick a starting point and watch it run on the tracks. Grouped by what your tags are like.</p>
      <section v-for="[group, recipes] in groups" :key="group">
        <h3>{{ group }}</h3>
        <button v-for="r in recipes" :key="r.title" class="recipe" @click="emit('load', r)">
          <strong>{{ r.title }}</strong>
          <span class="note">{{ r.note }}</span>
          <HighlightedFormat :format="r.format" class="preview" />
        </button>
      </section>
    </div>

    <div v-else class="scroll">
      <input v-model="query" type="search" placeholder="Search fields and functions…" class="search" />
      <section v-if="!q">
        <h3>Syntax</h3>
        <dl>
          <template v-for="s in SYNTAX" :key="s.code">
            <dt><HighlightedFormat :format="s.code" /></dt>
            <dd v-html="inlineMarkdown(s.doc)" />
          </template>
        </dl>
      </section>
      <section>
        <h3>Fields <span class="muted">({{ fields.length }})</span></h3>
        <button v-for="f in fields" :key="f.name" class="item" :title="`Insert %${f.name}%`" @click="emit('insert', `%${f.name}%`)">
          <span class="name tok-field">%{{ f.name }}%</span>
          <span class="doc" v-html="inlineMarkdown(f.doc)" />
        </button>
      </section>
      <section>
        <h3>Functions <span class="muted">({{ functions.length }})</span></h3>
        <button v-for="f in functions" :key="f.name" class="item" :title="`Insert $${f.name}(`" @click="emit('insert', `$${f.name}(`)">
          <span class="name"><span class="tok-fn">${{ f.name }}</span><span class="sig">{{ f.sig }}</span></span>
          <span class="doc" v-html="inlineMarkdown(f.doc)" />
        </button>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  background: var(--sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
header {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}
header button {
  background: none;
  border-color: transparent;
}
header button.active {
  border-color: var(--teal);
  color: var(--bright);
}
.spacer {
  flex: 1;
}
.scroll {
  overflow-y: auto;
  padding: 10px 12px 24px;
  flex: 1;
}
.intro {
  font-size: 0.85rem;
  margin: 0 0 8px;
}
h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--dim);
  margin: 16px 0 6px;
}
.recipe,
.item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  background: none;
  border: 1px solid transparent;
  padding: 6px 8px;
  margin-bottom: 4px;
}
.recipe:hover,
.item:hover {
  border-color: var(--border);
  background: rgba(7, 54, 66, 0.35);
}
.recipe strong {
  color: var(--bright);
  font-weight: 600;
}
.note {
  font-size: 0.83rem;
  color: var(--text);
}
.preview {
  font-size: 0.78rem;
  margin-top: 2px;
}
.search {
  width: 100%;
}
dl {
  margin: 0;
  font-size: 0.85rem;
}
dt {
  font-family: var(--mono);
  margin-top: 6px;
}
dd {
  margin: 0 0 0 12px;
}
.name {
  font-family: var(--mono);
  font-size: 0.9rem;
}
.sig {
  color: var(--dim);
}
.doc {
  font-size: 0.82rem;
  color: var(--text);
}
</style>
