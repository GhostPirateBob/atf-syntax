/** Minimal inline Markdown for catalogue docs: `code`, **bold** and *italic*. Everything is escaped first. */
export function inlineMarkdown(md: string): string {
  const escaped = md.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
  const parts = escaped.split(/(`[^`]*`)/)
  return parts
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1
        ? `<code>${part.slice(1, -1)}</code>`
        : part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>'),
    )
    .join('')
}
