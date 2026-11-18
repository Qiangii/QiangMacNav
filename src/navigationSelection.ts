import type { NavigationData } from './types';

export function orderedCategories(data: Pick<NavigationData, 'categories' | 'sidebarOrder'>) {
  const order = new Map(data.sidebarOrder.map((id, index) => [id, index]));
  return [...data.categories].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.position - b.position);
}

export function resolveCategorySelection(data: Pick<NavigationData, 'categories' | 'sidebarOrder' | 'sites'>, selected: unknown): string {
  if (typeof selected === 'string' && data.categories.some(category => category.id === selected)) return selected;
  const hasUncategorized = data.sites.some(site => site.categoryId === null);
  if (selected === 'uncategorized' && hasUncategorized) return 'uncategorized';
  return orderedCategories(data)[0]?.id ?? (hasUncategorized ? 'uncategorized' : '');
}

export function navigationView(data: NavigationData | null, display: NavigationData | null, selected: string) {
  if (!data || !display) return null;
  const selectedCategory = resolveCategorySelection(data, selected);
  const activeCategory = data.categories.find(category => category.id === selectedCategory);
  const categories = orderedCategories(display);
  const allSites = display.sites.filter(site => activeCategory ? site.categoryId === activeCategory.id : selectedCategory === 'uncategorized' && site.categoryId === null).sort((a, b) => a.position - b.position);
  return { selectedCategory, activeCategory, categories, allSites };
}
