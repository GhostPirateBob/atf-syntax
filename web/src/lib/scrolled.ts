import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * True once the page is scrolled more than 4 px (for the header's shadow).
 *
 * Read passively: an IntersectionObserver watches a 5 px sentinel at the very top of the page, and
 * the browser reports it asynchronously after its own layout. Nothing here reads scrollY or any
 * geometry, so the first layout is never forced inside the mount task (reading scrollY there cost
 * a 509 ms forced layout), and no handler runs on scroll. The observer's first report also sets
 * the initial state, a restored scroll position included.
 */
export function useScrolled(): Ref<boolean> {
  const scrolled = ref(false)
  let sentinel: HTMLElement | undefined
  let observer: IntersectionObserver | undefined
  onMounted(() => {
    sentinel = document.createElement('div')
    sentinel.setAttribute('aria-hidden', 'true')
    // Absolute against the initial containing block (body isn't positioned): the top of the page.
    sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:5px;visibility:hidden;pointer-events:none'
    document.body.prepend(sentinel)
    observer = new IntersectionObserver(([entry]) => {
      if (entry) scrolled.value = !entry.isIntersecting
    })
    observer.observe(sentinel)
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    sentinel?.remove()
  })
  return scrolled
}
