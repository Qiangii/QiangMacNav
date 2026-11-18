import { useState } from 'react';
import { AppWindow, Compass, Folder, Grid2X2, Plus, Settings } from 'lucide-react';
import { APP_ICONS } from '../visuals';

/** Keep Dock actions recognizable even if a deployment loses an asset. */
export function SystemIcon({ src }: { src: string }) {
  const [failedSource, setFailedSource] = useState<string>();
  if (failedSource !== src) return <img src={src} alt="" onError={() => setFailedSource(src)} />;
  const Icon = src === APP_ICONS.folder ? Folder
    : src === APP_ICONS.launchpad ? Grid2X2
    : src === APP_ICONS.safari ? Compass
    : src === APP_ICONS.settings ? Settings
    : src === APP_ICONS.appstore ? Plus : AppWindow;
  return <span className="system-icon-fallback" aria-hidden="true"><Icon size="65%" /></span>;
}
