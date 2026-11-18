import { forwardRef, useContext, useImperativeHandle, useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react';
import { DesktopAccountContext, isRecord, readDesktopCache, writeDesktopCache } from '../../desktopCache';
import './primitives.css';

export type MacScrollAreaProps = ComponentPropsWithoutRef<'div'> & { cacheKey?: string };
/** The element itself is the native scroll viewport; no extra layout wrapper. */
export const MacScrollArea = forwardRef<HTMLDivElement, MacScrollAreaProps>(function MacScrollArea({ className = '', cacheKey, onScroll, onWheel, onPointerDown, onKeyDown, ...props }, ref) {
  const account = useContext(DesktopAccountContext);
  const node = useRef<HTMLDivElement>(null);
  const restoring = useRef(false);
  useImperativeHandle(ref, () => node.current!, []);
  useLayoutEffect(() => {
    const element = node.current;
    if (!cacheKey || !element) return;
    const value = readDesktopCache(account, `scroll:${cacheKey}`);
    const top = isRecord(value) && typeof value.top === 'number' && Number.isFinite(value.top) ? Math.max(0, value.top) : 0;
    restoring.current = true;
    const restore = () => {
      if (!restoring.current || !element.clientHeight) return;
      element.scrollTop = top;
      if (Math.abs(element.scrollTop - top) < 1) restoring.current = false;
    };
    restore();
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    const mutations = new MutationObserver(() => {
      for (const child of element.children) observer.observe(child);
      restore();
    });
    mutations.observe(element, { childList: true, subtree: true });
    for (const child of element.children) observer.observe(child);
    return () => { observer.disconnect(); mutations.disconnect(); restoring.current = false; };
  }, [account, cacheKey]);
  return <div {...props} ref={node} className={`mac-scroll-area ${className}`}
    onWheel={event => { restoring.current = false; onWheel?.(event); }}
    onPointerDown={event => { restoring.current = false; onPointerDown?.(event); }}
    onKeyDown={event => { restoring.current = false; onKeyDown?.(event); }}
    onScroll={event => {
      if (cacheKey && !restoring.current) writeDesktopCache(account, `scroll:${cacheKey}`, { top: event.currentTarget.scrollTop });
      onScroll?.(event);
    }} />;
});
