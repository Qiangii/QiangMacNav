import { useEffect } from 'react';
import type { SessionActivity } from '../types';

// Check only on foreground entry or real input. No timer keeps an idle page alive.
export function useSessionActivity(identity: string, report: (signal: AbortSignal) => Promise<SessionActivity>) {
  useEffect(() => {
    if (!identity) return;
    const controller = new AbortController();
    let pending = false;
    let nextCheck = 0;
    const activity = async (event?: Event) => {
      if ((event && !event.isTrusted) || document.visibilityState !== 'visible' || pending || Date.now() < nextCheck) return;
      pending = true;
      try {
        const result = await report(controller.signal);
        nextCheck = Date.now() + Math.max(1, result.checkAfterSeconds) * 1000;
      } catch {
        // Retry on a later interaction. The normal auth flow handles a 401.
        nextCheck = Date.now() + 30_000;
      } finally { pending = false; }
    };
    const events = ['visibilitychange', 'pointerdown', 'keydown', 'wheel'] as const;
    events.forEach(name => document.addEventListener(name, activity, { capture: true, passive: true }));
    window.addEventListener('focus', activity);
    void activity();
    return () => {
      controller.abort();
      events.forEach(name => document.removeEventListener(name, activity, true));
      window.removeEventListener('focus', activity);
    };
  }, [identity, report]);
}
