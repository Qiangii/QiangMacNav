import { useEffect, type RefObject } from 'react';

// Wallpaper and large media previews share visibility and motion preferences.
export function useVideoPlayback(ref: RefObject<HTMLVideoElement | null>, source: string | undefined, enabled: boolean) {
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!enabled) { video.pause(); return; }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (document.hidden || reduced.matches) video.pause();
      else if (video.paused) void video.play().catch(() => {});
    };
    update();
    document.addEventListener('visibilitychange', update);
    reduced.addEventListener('change', update);
    video.addEventListener('play', update);
    return () => {
      video.pause();
      document.removeEventListener('visibilitychange', update);
      reduced.removeEventListener('change', update);
      video.removeEventListener('play', update);
    };
  }, [ref, source, enabled]);
}
