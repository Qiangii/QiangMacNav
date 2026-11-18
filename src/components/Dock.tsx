import { useMemo, type MouseEvent } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { openSite } from '../api';
import type { Category, DockTool, NavigationData, Site } from '../types';
import { APP_ICONS } from '../visuals';
import { SiteIcon } from './SiteIcon';
import { SystemIcon } from './SystemIcon';
import { MediaPreview } from './MediaPreview';
import { useDockMagnification } from './useDockMagnification';
import { MacTooltip } from './ui';
import { DEFAULT_DOCK_TOOLS, DOCK_TOOLS } from './dockTools';
import { useNavigationIndex } from './useNavigationIndex';

export type DockEntry = NavigationData['dockItems'][number];

export type DockPinnedItemProps = {
  item: DockEntry;
  site?: Site;
  category?: Category;
  onSiteMenu: (event: MouseEvent, site: Site) => void;
  onCategoryMenu: (event: MouseEvent, category: Category) => void;
  onOpenCategory: (category: Category) => void;
};

function DockPinnedItem({ item, site, category, onSiteMenu, onCategoryMenu, onOpenCategory }: DockPinnedItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `dock:${item.kind}:${item.id}` });
  const label = site?.name ?? category?.name ?? '';
  return <MacTooltip content={label} disabled={isDragging}><button ref={setNodeRef} className={`dock-icon ${site ? 'dock-site' : 'dock-folder'} ${isDragging ? 'dock-dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} onClick={() => site ? openSite(site) : category && onOpenCategory(category)} onContextMenu={event => site ? onSiteMenu(event, site) : category && onCategoryMenu(event, category)} aria-label={`打开 ${label}`} {...attributes} {...listeners}>{site ? <SiteIcon site={site} /> : <MediaPreview url={category?.iconUrl} fallback={<SystemIcon src={APP_ICONS.folder} />} />}</button></MacTooltip>;
}

export type DockProps = {
  items: DockEntry[];
  sites: Site[];
  categories: Category[];
  onSiteMenu: (event: MouseEvent, site: Site) => void;
  onCategoryMenu: (event: MouseEvent, category: Category) => void;
  onOpenCategory: (category: Category) => void;
  onSettings: () => void;
  onSearch: () => void;
  onHome: () => void;
  onAdd: () => void;
  onReorder: (ids: string[]) => void;
  canEdit: boolean;
  tools?: DockTool[];
  onToolMenu: (event: MouseEvent, tool: DockTool) => void;
};

export function Dock({ items, sites, categories, onSiteMenu, onCategoryMenu, onOpenCategory, onSettings, onSearch, onHome, onAdd, onReorder, canEdit, tools = DEFAULT_DOCK_TOOLS, onToolMenu }: DockProps) {
  const dockSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const { siteById, categoryById } = useNavigationIndex(sites, categories);
  const pinnedItems = useMemo(() => items.filter(item => item.kind === 'site' ? siteById.has(item.id) : categoryById.has(item.id)), [items, siteById, categoryById]);
  const visibleTools = DOCK_TOOLS.filter(tool => tools.includes(tool.id));
  const { dockRef, resetMagnification } = useDockMagnification([...pinnedItems.map(item => `${item.kind}:${item.id}`), ...visibleTools.map(tool => tool.id)].join('|'));
  const actions = { navigation: onHome, search: onSearch, add: onAdd, settings: onSettings };
  if (!pinnedItems.length && !visibleTools.length) return null;

  return <div className="dock-wrap"><nav id="desktop-dock" ref={dockRef} aria-label="Dock" className="dock" onPointerDown={event => { if (event.target instanceof Element && event.target.closest('button')) event.preventDefault(); }}>
    {pinnedItems.length > 0 && <><DndContext sensors={dockSensors} collisionDetection={closestCenter} onDragStart={resetMagnification} onDragCancel={resetMagnification} onDragEnd={event => {
      resetMagnification();
      const ids = pinnedItems.map(item => `dock:${item.kind}:${item.id}`);
      const oldIndex = ids.indexOf(String(event.active.id));
      const newIndex = ids.indexOf(String(event.over?.id ?? ''));
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) onReorder(arrayMove(pinnedItems, oldIndex, newIndex).map(item => `${item.kind}:${item.id}`));
    }}><SortableContext items={pinnedItems.map(item => `dock:${item.kind}:${item.id}`)} strategy={rectSortingStrategy}><div className="dock-group pinned-group">{pinnedItems.map(item => <DockPinnedItem key={`${item.kind}:${item.id}`} item={item} site={item.kind === 'site' ? siteById.get(item.id) : undefined} category={item.kind === 'category' ? categoryById.get(item.id) : undefined} onSiteMenu={onSiteMenu} onCategoryMenu={onCategoryMenu} onOpenCategory={onOpenCategory} />)}</div></SortableContext></DndContext>{visibleTools.length > 0 && <span className="dock-divider" />}</>}
    {visibleTools.length > 0 && <div className="dock-group dock-tools">{visibleTools.map(tool => <MacTooltip key={tool.id} content={tool.label}><button className={`dock-icon dock-app${tool.id === 'navigation' ? ' dock-finder' : ''}`} aria-label={tool.label} aria-haspopup="menu" disabled={tool.id === 'add' && !canEdit} onClick={actions[tool.id]} onContextMenu={event => onToolMenu(event, tool.id)}><SystemIcon src={tool.icon} /></button></MacTooltip>)}</div>}
  </nav></div>;
}
