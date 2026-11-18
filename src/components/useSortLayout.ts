import { useLayoutEffect, useRef, type DependencyList } from 'react';

export const sortDuration = 180;
export const sortEasing = 'cubic-bezier(.2,.8,.2,1)';

// Animate layout changes, not the pointer-following overlay. Real DOM slots remain
// the collision targets throughout the animation.
export function useSortLayout(dependencies: DependencyList) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, DOMRect>());
  const animations = useRef(new Map<HTMLElement, Animation>());
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) { previous.current.clear(); return; }
    const origin = container.getBoundingClientRect();
    const measure = (node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      return new DOMRect(rect.left - origin.left + container.scrollLeft, rect.top - origin.top + container.scrollTop, rect.width, rect.height);
    };
    const next = new Map<string, DOMRect>();
    const visual = new Map<string, DOMRect>();
    const nodes = container.querySelectorAll<HTMLElement>('[data-sort-id]');
    const wasAnimating = animations.current.size > 0;
    if (wasAnimating) nodes.forEach(node => visual.set(node.dataset.sortId!, measure(node)));
    // Cancel only our FLIP animations, not hover/other component effects.
    animations.current.forEach(animation => animation.cancel());
    animations.current.clear();
    nodes.forEach(node => next.set(node.dataset.sortId!, measure(node)));
    const offsets = new Map<string, { x: number; y: number }>();
    nodes.forEach(node => {
      const id = node.dataset.sortId!, rect = next.get(id)!, old = previous.current.get(id);
      const current = visual.get(id) ?? rect;
      offsets.set(id, { x: old ? old.left - rect.left + current.left - rect.left : 0, y: old ? old.top - rect.top + current.top - rect.top : 0 });
    });
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const viewportTop = container.scrollTop - 80, viewportBottom = container.scrollTop + container.clientHeight + 80;
    nodes.forEach(node => {
      const id = node.dataset.sortId!;
      const old = previous.current.get(id);
      const rect = next.get(id)!;
      const visible = rect.bottom >= viewportTop && rect.top <= viewportBottom || old && old.bottom >= viewportTop && old.top <= viewportBottom;
      if (old && visible && !node.classList.contains('sort-placeholder') && !reducedMotion) {
        const parentId = node.parentElement?.closest<HTMLElement>('[data-sort-id]')?.dataset.sortId;
        const parent = parentId ? offsets.get(parentId) : undefined;
        const offset = offsets.get(id)!;
        const x = offset.x - (parent?.x ?? 0);
        const y = offset.y - (parent?.y ?? 0);
        if (x || y) {
          const animation = node.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0px, 0px)' }], { duration: sortDuration, easing: sortEasing });
          animations.current.set(node, animation);
          animation.onfinish = () => { if (animations.current.get(node) === animation) animations.current.delete(node); };
        }
      }
    });
    previous.current = next;
  }, dependencies);
  useLayoutEffect(() => () => {
    animations.current.forEach(animation => animation.cancel());
    animations.current.clear();
  }, []);
  return ref;
}
