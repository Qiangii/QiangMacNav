import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useVideoPlayback } from './useVideoPlayback';

/** A failed source resets on URL changes. Images and fallback text never overlap. */
export function MediaPreview({ url, mime = '', className, alt = '', fallback = null, play = false, loading }: {
  url?: string; mime?: string; className?: string; alt?: string; fallback?: ReactNode; play?: boolean; loading?: 'lazy' | 'eager';
}) {
  const [failed, setFailed] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);
  useVideoPlayback(video, url, play && mime === 'video/mp4' && failed !== url);
  if (!url || failed === url) return <>{fallback}</>;
  return mime === 'video/mp4'
    ? <video key={url} ref={video} className={className} src={url} aria-label={alt || undefined} muted loop playsInline preload="metadata" onError={() => setFailed(url)} />
    : <img key={url} className={className} src={url} alt={alt} loading={loading} draggable={false} decoding="async" onError={() => setFailed(url)} />;
}
