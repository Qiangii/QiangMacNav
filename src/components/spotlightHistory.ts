import type { Site } from '../types';

export const SPOTLIGHT_HISTORY_KEY = 'spotlight:recent';
export const SPOTLIGHT_HISTORY_LIMIT = 20;

export function readRecentSiteIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128))].slice(0, SPOTLIGHT_HISTORY_LIMIT);
}

export function rememberSite(recent: readonly string[], id: string): string[] {
  return readRecentSiteIds([id, ...recent]);
}

export function recentSites(sites: readonly Site[], recent: readonly string[]): Site[] {
  const visible = new Map(sites.map(site => [site.id, site]));
  return readRecentSiteIds(recent).flatMap(id => {
    const site = visible.get(id);
    return site ? [site] : [];
  });
}
