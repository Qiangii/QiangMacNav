import { useCallback, useReducer } from 'react';
import { desktopWindowsReducer, restoreWindows, type DesktopWindowMode, type DesktopWindowsState, type DesktopWindowAction } from './desktopWindows';

/** Registry keys identify independent desktop windows. Modal tools stay with their owners. */
export function useDesktopWindows<K extends string>(defaults: Record<K, DesktopWindowMode>) {
  const [state, dispatch] = useReducer(
    (state: DesktopWindowsState<K>, action: DesktopWindowAction<K>) => desktopWindowsReducer(state, action),
    defaults, value => restoreWindows(value),
  );
  const open = useCallback((id: K) => dispatch({ type: 'open', id }), []);
  const close = useCallback((id: K) => dispatch({ type: 'close', id }), []);
  const minimize = useCallback((id: K) => dispatch({ type: 'minimize', id }), []);
  const focus = useCallback((id: K) => dispatch({ type: 'focus', id }), []);
  const toggle = useCallback((id: K) => {
    const bounds = new Map<string, DOMRect>();
    for (const element of document.querySelectorAll<HTMLElement>('[data-desktop-window]')) {
      bounds.set(element.dataset.desktopWindow!, element.getBoundingClientRect());
    }
    dispatch({ type: 'toggle', id, bounds });
  }, []);
  const restore = useCallback((saved?: unknown) => dispatch({ type: 'restore', state: restoreWindows(defaults, saved) }), [defaults]);
  const focused = state.order.at(-1) ?? null;
  function window(id: K) {
    return {
      open: state.modes[id] !== 'closed', visible: state.modes[id] === 'visible', minimized: state.modes[id] === 'minimized',
      focused: focused === id, zIndex: 15 + Math.max(0, state.order.indexOf(id)),
      onClose: () => close(id), onMinimize: () => minimize(id), onFocusWindow: () => focus(id),
    };
  }
  return { state, focused, open, close, minimize, focus, toggle, restore, window };
}
