import { useEffect, useRef, useState } from 'react';
import type { Preferences } from '../types';
import { WALLPAPERS } from '../visuals';
import { useVideoPlayback } from './useVideoPlayback';

export function DesktopWallpaper({ preferences }: { preferences: Preferences }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState('');
  const builtin = WALLPAPERS[preferences.wallpaper] ?? WALLPAPERS.shinchan;
  const url = preferences.wallpaperUrl || ('video' in builtin ? builtin.video : '');
  const isVideo = !!url && url !== failed && (preferences.wallpaperUrl ? preferences.wallpaperMime === 'video/mp4' : 'video' in builtin);
  const fallback = builtin.image;
  useEffect(() => { setFailed(''); }, [url]);
  useVideoPlayback(video, url, isVideo);
  return <div className="desktop-wallpaper" aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(fallback)})` }}>
    {isVideo ? <video key={url} ref={video} src={url} poster={preferences.wallpaperUrl ? undefined : fallback} muted loop playsInline preload="metadata" onError={() => setFailed(url)} />
      : url && url !== failed ? <img key={url} src={url} alt="" draggable={false} onError={() => setFailed(url)} /> : null}
  </div>;
}
