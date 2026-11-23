import { useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { usePresenceActive } from './MacPresence';
import { DesktopAccountContext, isRecord, readDesktopCache, writeDesktopCache } from '../../desktopCache';
import { resizeWindowGeometry, type WindowGeometry, type WindowResizeDirection } from './windowGeometry';

export type { WindowGeometry } from './windowGeometry';
export type MacWindowOptions = {
  fit: () => WindowGeometry;
  minSize?: { width: number; height: number };
  bottomInset?: number;
  hidden?: boolean;
  allowCompact?: boolean;
  cacheKey?: string;
  onClose: () => void;
  onMinimize: () => void;
};

export function useMacWindow({ fit, minSize = { width: 640, height: 300 }, bottomInset = 85, hidden = false, allowCompact = false, cacheKey, onClose, onMinimize }: MacWindowOptions) {
  const active = usePresenceActive();
  const account = useContext(DesktopAccountContext);
  function clamp(value: WindowGeometry): WindowGeometry {
    const width = Math.min(Math.max(minSize.width, value.size.width), Math.max(0, window.innerWidth - 24));
    const height = Math.min(Math.max(minSize.height, value.size.height), Math.max(0, window.innerHeight - bottomInset - 10));
    return { size: { width, height }, position: {
      x: Math.max(0, Math.min(value.position.x, window.innerWidth - width)),
      y: Math.max(0, Math.min(value.position.y, window.innerHeight - height - bottomInset)),
    } };
  }
  const [saved] = useState(() => cacheKey ? readDesktopCache(account, `window:${cacheKey}`) : null);
  const [geometry, setGeometry] = useState(() => {
    if (isRecord(saved) && isRecord(saved.position) && isRecord(saved.size)) {
      const { x, y } = saved.position, { width, height } = saved.size;
      if ([x, y, width, height].every(n => typeof n === 'number' && Number.isFinite(n)) && (width as number) > 0 && (height as number) > 0)
        return clamp({ position: { x: x as number, y: y as number }, size: { width: width as number, height: height as number } });
    }
    return fit();
  });
  const [maximized, setMaximized] = useState(isRecord(saved) && saved.maximized === true);
  const gestureCleanup = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (cacheKey) writeDesktopCache(account, `window:${cacheKey}`, { ...geometry, maximized });
  }, [account, cacheKey, geometry, maximized]);

  useEffect(() => {
    const resize = () => { gestureCleanup.current?.(); setGeometry(previous => clamp(previous)); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [minSize.width, minSize.height, bottomInset]);

  useEffect(() => {
    if (hidden || !active) gestureCleanup.current?.();
    return () => {
      gestureCleanup.current?.();
    };
  }, [hidden, active]);

  function exit(kind: 'close' | 'minimize') {
    gestureCleanup.current?.();
    // Visibility is owned by MacPresence, including Dock-driven exits.
    (kind === 'close' ? onClose : onMinimize)();
  }

  function startGesture(event: PointerEvent<HTMLElement>, resize?: WindowResizeDirection) {
    if (hidden || !active || maximized || (!allowCompact && window.innerWidth <= 760) || event.button !== 0) return;
    if (!resize && event.target instanceof Element && event.target.closest('button, input, textarea, select, a, [contenteditable="true"], [data-no-drag]')) return;
    event.preventDefault();
    gestureCleanup.current?.();
    const target = event.currentTarget;
    const { position, size } = geometry;
    const origin = { x: event.clientX, y: event.clientY };
    const pointerId = event.pointerId;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const dx = next.clientX - origin.x;
      const dy = next.clientY - origin.y;
      setGeometry(resize ? resizeWindowGeometry({ position, size }, resize, { x: dx, y: dy }, { width: window.innerWidth, height: window.innerHeight }, minSize, bottomInset) : {
        size,
        position: {
          x: Math.max(0, Math.min(Math.max(0, window.innerWidth - size.width), position.x + dx)),
          y: Math.max(0, Math.min(Math.max(0, window.innerHeight - size.height - bottomInset), position.y + dy)),
        },
      });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', stop);
      target.removeEventListener('lostpointercapture', stop);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      gestureCleanup.current = null;
    };
    const end = (next: globalThis.PointerEvent) => { if (next.pointerId === pointerId) stop(); };
    gestureCleanup.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', stop);
    target.addEventListener('lostpointercapture', stop);
    target.setPointerCapture(pointerId);
  }

  return {
    ...geometry, maximized, allowCompact,
    style: maximized ? undefined : { left: geometry.position.x, top: geometry.position.y, ...geometry.size },
    startMove: (event: PointerEvent<HTMLElement>) => startGesture(event),
    startResize: (event: PointerEvent<HTMLDivElement>, direction: WindowResizeDirection) => startGesture(event, direction),
    toggleMaximize: () => { gestureCleanup.current?.(); setMaximized(value => !value); },
    close: () => exit('close'),
    minimize: () => exit('minimize'),
  };
}
