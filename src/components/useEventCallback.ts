import { useCallback, useLayoutEffect, useRef } from 'react';

// Stable event props for memoized lists, always dispatching to the latest commit.
export function useEventCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const current = useRef(callback);
  useLayoutEffect(() => { current.current = callback; });
  return useCallback((...args: Args) => current.current(...args), []);
}
