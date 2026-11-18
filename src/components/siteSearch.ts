import type { Site } from '../types';

// Both search entry points receive the server's account-visible site snapshot.
// Preserve its order and include all matches, regardless of the selected category.
export function searchSites(sites: Site[], query: string): Site[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return sites;
  return sites.filter(site => [site.name, site.url, site.note].some(value => value.toLocaleLowerCase().includes(term)));
}
