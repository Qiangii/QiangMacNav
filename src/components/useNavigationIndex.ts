import { useMemo } from 'react';
import type { Category, Site } from '../types';

export function useNavigationIndex(sites: Site[], categories: Category[]) {
  return useMemo(() => ({
    siteById: new Map(sites.map(site => [site.id, site])),
    categoryById: new Map(categories.map(category => [category.id, category])),
  }), [sites, categories]);
}
