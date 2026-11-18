import { createContext, useCallback, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Preferences } from '../types';

export type NavigationDragMode = Preferences['navigationDragMode'];
const navigationCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const category = String(args.context.active?.id).startsWith('category:');
  // Nested site rectangles must not intercept arrow movement between categories.
  const droppableRects = new Map([...args.context.droppableRects].filter(([id]) => category
    ? String(id).startsWith('category:') && id !== 'category:none'
    : !String(id).startsWith('category:')));
  return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableRects } });
};
export function useNavigationSensors(mode: NavigationDragMode, area: 'content' | 'sidebar' = 'content') {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: mode === 'longPress' ? { delay: 350, tolerance: 7 } : { distance: 7 } }),
    // Touch uses its own sensor so moving before the hold activates can scroll natively.
    useSensor(TouchSensor, { activationConstraint: { delay: mode === 'longPress' ? 350 : 200, tolerance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: area === 'sidebar' ? sortableKeyboardCoordinates : navigationCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter', 'Tab'] } }),
  );
}

export function useNavigationDrag(mode: NavigationDragMode) {
  const blockedUntil = useRef(0);
  useEffect(() => {
    // Let dnd-kit receive Escape, while keeping the parent Finder window open.
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && blockedUntil.current === Infinity) event.preventDefault(); };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);
  const begin = useCallback(() => {
    blockedUntil.current = Infinity;
    document.dispatchEvent(new Event('mac-tooltip-dismiss'));
  }, []);
  const end = useCallback(() => { blockedUntil.current = performance.now() + 400; }, []);
  // Lives above sortable rows: crossing categories can unmount the original row.
  const guard = useCallback((event: MouseEvent) => {
    if (performance.now() < blockedUntil.current) { event.preventDefault(); event.stopPropagation(); }
  }, []);
  return useMemo(() => ({ mode, begin, end, guard }), [mode, begin, end, guard]);
}

export const NavigationDragContext = createContext<ReturnType<typeof useNavigationDrag>>({ mode: 'handle', begin() {}, end() {}, guard() {} });
