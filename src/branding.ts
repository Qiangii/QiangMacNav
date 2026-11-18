import { useEffect } from 'react';
import type { SiteBranding } from './types';

export const DEFAULT_BRANDING: SiteBranding = { siteTitle: 'QiangMacNav', siteLogoUrl: '/assets/brand-logo.svg' };

export function useSiteBranding(branding: SiteBranding | null) {
  const title = branding?.siteTitle || DEFAULT_BRANDING.siteTitle;
  const logo = branding?.siteLogoUrl || DEFAULT_BRANDING.siteLogoUrl;
  useEffect(() => {
    document.title = title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = `${title} · 你的常用网站与个人收藏。`;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) return;
    icon.removeAttribute('type');
    icon.href = logo;
    const image = new Image();
    image.onerror = () => { icon.href = DEFAULT_BRANDING.siteLogoUrl; };
    image.src = logo;
    return () => { image.onerror = null; };
  }, [title, logo]);
}
