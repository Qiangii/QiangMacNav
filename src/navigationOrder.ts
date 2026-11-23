import type { CategorySiteOrder, DesktopItem, NavigationData } from './types';

const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
const members = (a: string[], b: string[]) => same([...a].sort(), [...b].sort());
const changed = () => new Error('布局内容已变更，请重新拖动');
const itemKey = (item: { kind: string; id: string }) => `${item.kind}:${item.id}`;
export const categorySiteIds = (data: NavigationData, categoryId: string | null) => data.sites
  .filter(site => site.editable && site.categoryId === categoryId)
  .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(site => site.id);

export function orderCategorySites(data: NavigationData, groups: CategorySiteOrder[]): NavigationData {
  const positions = new Map<string, number>();
  for (const group of groups) {
    if (group.categoryId !== null && !data.categories.some(category => category.id === group.categoryId && category.editable)) throw changed();
    if (!same(categorySiteIds(data, group.categoryId), group.previousIds) || !members(group.previousIds, group.ids)) throw changed();
    group.ids.forEach((id, index) => positions.set(id, index));
  }
  return { ...data, sites: data.sites.map(site => positions.has(site.id) ? { ...site, position: positions.get(site.id)! } : site) };
}

export function orderSidebar(data: NavigationData, ids: string[]): NavigationData {
  if (!members(data.categories.map(category => category.id), ids)) throw changed();
  return { ...data, sidebarOrder: ids };
}

export function orderDock(data: NavigationData, ids: string[]): NavigationData {
  if (!members(data.dockItems.map(itemKey), ids)) throw changed();
  const items = new Map(data.dockItems.map(item => [itemKey(item), item]));
  return { ...data, dockItems: ids.map(id => items.get(id)!) };
}

export function orderDesktop(data: NavigationData, items: DesktopItem[], columns: number, rows: number): NavigationData {
  if (!members(data.desktopItems.map(itemKey), items.map(itemKey))) throw changed();
  return { ...data, desktopItems: [...items].sort((a, b) => a.position - b.position), desktopColumns: columns, desktopRows: rows };
}

export function moveNavigationSite(data: NavigationData, id: string, categoryId: string | null, index: number): NavigationData {
  if (!data.sites.some(site => site.id === id && site.editable) || categoryId !== null && !data.categories.some(category => category.id === categoryId && category.editable)) throw changed();
  const ids = categorySiteIds(data, categoryId).filter(siteId => siteId !== id);
  if (index < 0 || index > ids.length) throw changed();
  ids.splice(index, 0, id);
  const positions = new Map(ids.map((siteId, position) => [siteId, position]));
  return { ...data, sites: data.sites.map(site => positions.has(site.id) ? { ...site, categoryId, position: positions.get(site.id)! } : site) };
}
