import { useContext, useEffect, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { favIcon } from '../api';
import type { Site } from '../types';
import { DEFAULT_ICON_BACKGROUND, IconAppearanceContext } from './IconAppearance';

export function SiteIcon({ site }: { site: Site }) {
  const [failed, setFailed] = useState(false);
  const source = favIcon(site);
  const appearance = useContext(IconAppearanceContext);
  const enabled = appearance.iconBackgroundEnabled ?? true;
  const fill = appearance.iconBackgroundColor || DEFAULT_ICON_BACKGROUND;
  useEffect(() => setFailed(false), [source]);
  return <span className="site-icon" aria-hidden="true">
    {!failed && source ? <img key={source} src={source} alt="" draggable={false} decoding="async"
      style={{ backgroundColor: enabled ? fill : 'transparent' }}
      onLoad={({ currentTarget: image }) => { image.dataset.portrait = String(image.naturalHeight > image.naturalWidth); }}
      onError={() => setFailed(true)} /> : <Globe2 size={21} strokeWidth={1.8} />}
  </span>;
}
