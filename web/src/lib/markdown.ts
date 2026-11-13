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

/** inlineMarkdown plus `[text](url)` links (http(s) and `#anchor` only), for longer docs text. */
export function docMarkdown(md: string): string {
  return inlineMarkdown(md).replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|#)[^)\s"]+)\)/g,
    (_, text: string, url: string) =>
      url.startsWith('#') ? `<a href="${url}">${text}</a>` : `<a href="${url}" target="_blank" rel="noopener">${text}</a>`,
  )
}
