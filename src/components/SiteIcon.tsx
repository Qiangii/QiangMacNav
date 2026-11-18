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
  const background = enabled ? fill : 'transparent';
  const channels = fill.slice(1).match(/.{2}/g)?.map(value => parseInt(value, 16)) ?? [247, 248, 250];
  const foreground = channels[0] * .299 + channels[1] * .587 + channels[2] * .114 > 150 ? '#334155' : '#f1f5f9';
  useEffect(() => setFailed(false), [source]);
  return <span className="site-icon" aria-hidden="true" style={{ background, color: enabled ? foreground : undefined, boxShadow: enabled ? undefined : 'none' }}>
    {!failed && source ? <img src={source} alt="" draggable={false} decoding="async" style={{ background: 'transparent' }} onError={() => setFailed(true)} /> : <Globe2 size={21} strokeWidth={1.8} />}
  </span>;
}
