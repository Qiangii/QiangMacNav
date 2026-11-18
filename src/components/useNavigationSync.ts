import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { api } from '../api';
import type { NavigationData } from '../types';
import { useEventCallback } from './useEventCallback';

const interacting = () => !!document.querySelector('[aria-busy="true"], [role="menu"], .sorting, .dragging, .sort-placeholder, .desktop-selection-box');

// Refresh active desktops, including other signed-in accounts. Retain drafts
// during edits and never overwrite a newer foreground response with a poll.
export function useNavigationSync(data: NavigationData | null, setData: Dispatch<SetStateAction<NavigationData | null>>, enabled: boolean) {
  const read = useEventCallback(async (signal: AbortSignal) => {
    if (!data || interacting()) return;
    const snapshot = data;
    const result = await api.navigation(signal);
    if (!signal.aborted && !interacting()) {
      setData(current => current === snapshot && JSON.stringify(current) !== JSON.stringify(result) ? result : current);
    }
  });
  useEffect(() => {
    if (!enabled) return;
    let request: AbortController | undefined;
    const sync = async () => {
      if (document.visibilityState === 'hidden') { request?.abort(); return; }
      if (request) return;
      const controller = new AbortController();
      request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try { await read(controller.signal); }
      catch { /* Session expiry is handled by api; transient failures retry on the next tick. */ }
      finally { clearTimeout(timeout); if (request === controller) request = undefined; }
    };
    const timer = window.setInterval(() => { void sync(); }, 5000);
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(timer); request?.abort();
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [enabled, read]);
}
