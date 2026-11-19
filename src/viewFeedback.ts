import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

let visit = 0;
export const currentFeedbackVisit = () => visit;
export function subscribeFeedback(listener: () => void) {
  window.addEventListener('mac-feedback-reset', listener);
  return () => window.removeEventListener('mac-feedback-reset', listener);
}
export function dismissNotifications() {
  visit++;
  window.dispatchEvent(new Event('mac-feedback-reset'));
}
export const useFeedbackVisit = () => useSyncExternalStore(subscribeFeedback, currentFeedbackVisit);

// Bind both the displayed value and delayed setters to the originating view.
export function useViewFeedback<T>(empty: T) {
  const origin = useFeedbackVisit();
  const [result, setResult] = useState({ origin, value: empty });
  const set = useCallback((value: T, source = origin) => {
    if (source === currentFeedbackVisit()) setResult({ origin: source, value });
  }, [origin]);
  return [origin === result.origin ? result.value : empty, set] as const;
}

export function useWindowFeedback() {
  useEffect(() => {
    const hidden = () => { if (document.hidden) dismissNotifications(); };
    window.addEventListener('blur', dismissNotifications);
    window.addEventListener('focus', dismissNotifications);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', dismissNotifications);
      window.removeEventListener('focus', dismissNotifications);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
}
