import { Folder } from 'lucide-react';
import { MediaPreview } from './MediaPreview';

export function CategoryIcon({ url, size = 19, className = '' }: { url?: string; size?: number; className?: string }) {
  return <span className={`category-image ${className}`} style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }} aria-hidden="true">
    <MediaPreview url={url} fallback={<Folder size={size} fill="currentColor" strokeWidth={1.5} />} />
  </span>;
}
