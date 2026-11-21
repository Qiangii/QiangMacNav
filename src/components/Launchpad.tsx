import { isCachedText, useDesktopState } from '../desktopCache';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Search, X } from 'lucide-react';
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type CollisionDetection } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Category, CategorySiteOrder, Preferences, Site } from '../types';
import { uncategorizedCategory } from '../navigationSelection';
import { LaunchpadArtwork, LaunchpadIcon, type LaunchpadEntry } from './LaunchpadIcon';
import { MacButton, MacDialog, MacInput } from './ui';
import { NAVIGATION_MENU_IDS } from './ContextMenu';
import './launchpad.css';

export function Launchpad({ categories, sites, onCategory, onClose, onSiteMenu, category, scrollMode = 'horizontal', showDragGrid, savingOrder, onSiteOrder }: {
  categories: Category[];
  sites: Site[];
  onCategory: (category: Category) => void;
  onClose: () => void;
  onSiteMenu: (event: MouseEvent | React.KeyboardEvent, site: Site) => void;
  category?: Category;
  scrollMode?: Preferences['launchpadScrollMode'];
  showDragGrid: boolean;
  savingOrder: boolean;
  onSiteOrder: (groups: CategorySiteOrder[]) => Promise<boolean>;
}) {
  const [query, setQuery] = useDesktopState(category ? `desktop-category:${category.id}:query` : 'launchpad:query', '', isCachedText);
  const search = query.trim().toLocaleLowerCase();
  const [order, setOrder] = useDesktopState<string[]>(category ? `desktop-category:${category.id}:order` : 'launchpad:order', [], (value): value is string[] => Array.isArray(value) && value.every(key => typeof key === 'string'));
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [hasDragged, setHasDragged] = useState(false);
  const overlayItem = useRef<HTMLDivElement>(null);
  const gridHost = useRef<HTMLDivElement>(null);
  const release = useRef<{ key: string; rect: DOMRect } | null>(null);
  const blockedUntil = useRef(0);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }));
  const categoryId = category?.id === uncategorizedCategory.id ? null : category?.id;
  const categorySites = category ? sites.filter(site => site.categoryId === categoryId).sort((a, b) => a.position - b.position) : sites;
  const rank = new Map((category ? [] : order).map((key, i) => [key, i]));
  const source: LaunchpadEntry[] = [...(category ? [] : categories).map(item => ({ kind: 'category' as const, key: `category:${item.id}`, item })), ...categorySites.map(item => ({ kind: 'site' as const, key: `site:${item.id}`, item }))];
  const canSort = (entry: LaunchpadEntry) => (!category || category.editable) && entry.item.editable;
  // Local orders from earlier versions may include read-only entries. Keep those
  // slots in server order and apply the personal order only to the remaining slots.
  const owned = source.filter(canSort);
  // The overview remembers which slots belong to each category. Fill its site
  // slots in navigation order, even when an older cache lists other site IDs first.
  const siblings = new Map<string | null, LaunchpadEntry[]>();
  for (const entry of owned) {
    if (entry.kind !== 'site') continue;
    const group = siblings.get(entry.item.categoryId) ?? [];
    group.push(entry);
    siblings.set(entry.item.categoryId, group);
  }
  for (const group of siblings.values()) group.sort((a, b) => a.item.position - b.item.position).reverse();
  const movable = owned.sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity))
    .map(entry => entry.kind === 'site' ? siblings.get(entry.item.categoryId)!.pop()! : entry);
  const pendingRank = new Map(pendingOrder?.map((key, i) => [key, i]));
  const displayed = pendingOrder ? [...movable].sort((a, b) => (pendingRank.get(a.key) ?? Infinity) - (pendingRank.get(b.key) ?? Infinity)) : movable;
  let nextMovable = 0;
  const all = source.map(entry => canSort(entry) ? displayed[nextMovable++] : entry);
  const visible = all.filter(entry => (entry.kind === 'site' ? `${entry.item.name} ${entry.item.note}` : entry.item.name).toLocaleLowerCase().includes(search));
  const active = all.find(entry => entry.key === activeKey);
  const horizontal = scrollMode === 'horizontal';
  const viewport = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 7, rows: 1 });
  const [page, setPage] = useState(0);
  const pageSize = layout.columns * layout.rows;
  const sortingEnabled = !search && !savingOrder;
  const entries = visible.map((entry, index) => <LaunchpadIcon key={entry.key} entry={entry} index={index} sortable={sortingEnabled && canSort(entry)} sorting={!!activeKey} blocked={() => !!activeKey || Date.now() < blockedUntil.current} onCategory={onCategory} onClose={onClose} onSiteMenu={onSiteMenu} />);
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const keys = sortingEnabled ? movable.map(entry => entry.key) : [];
  const collision: CollisionDetection = args => {
    if (!args.pointerCoordinates) return closestCenter(args);
    const { x, y } = args.pointerCoordinates;
    const hit = document.elementFromPoint(x, y);
    if (hit?.closest('[data-sort-locked]')) return [];
    const cellArea = hit?.closest('.launchpad-grid');
    if (!cellArea) return [];
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(item => cellArea.contains(item.node.current)) });
  };
  function finishDrag() {
    blockedUntil.current = Date.now() + 350;
    setActiveKey(null);
  }
  useLayoutEffect(() => {
    const drop = release.current;
    if (activeKey || !drop) return;
    release.current = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const icon = gridHost.current?.querySelector<HTMLElement>(`[data-launchpad-key="${CSS.escape(drop.key)}"] .launchpad-cell-motion`);
    if (!icon) return;
    const target = icon.getBoundingClientRect();
    const x = drop.rect.left - target.left, y = drop.rect.top - target.top;
    const animation = icon.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
    return () => animation.cancel();
  }, [activeKey]);
  useEffect(() => {
    const node = viewport.current;
    if (!activeKey || !node || pageCount < 2) return;
    let timer: number | undefined;
    let direction = 0;
    const turn = () => {
      const current = Math.round(node.scrollLeft / node.clientWidth);
      const next = Math.max(0, Math.min(pageCount - 1, current + direction));
      if (next === current) return;
      node.scrollTo({ left: next * node.clientWidth, behavior: 'instant' });
      timer = window.setTimeout(turn, 650);
    };
    const track = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const inside = event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX >= rect.left && event.clientX <= rect.right;
      const next = !inside ? 0 : event.clientX < rect.left + 30 ? -1 : event.clientX > rect.right - 30 ? 1 : 0;
      if (next === direction) return;
      direction = next; clearTimeout(timer);
      if (direction) timer = window.setTimeout(turn, 450);
    };
    window.addEventListener('pointermove', track);
    return () => { clearTimeout(timer); window.removeEventListener('pointermove', track); };
  }, [activeKey, pageCount]);
  const goToPage = (index: number) => {
    const node = viewport.current;
    if (!node) return;
    document.dispatchEvent(new Event('mac-tooltip-dismiss'));
    node.scrollTo({ left: Math.max(0, Math.min(pageCount - 1, index)) * node.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!horizontal || !node) return;
    const measure = () => {
      const small = window.innerWidth <= 760;
      const columns = Math.max(1, Math.min(small ? 4 : 7, Math.floor(node.clientWidth / (small ? 78 : 110))));
      const rows = Math.max(1, Math.floor((node.clientHeight + 20) / (small ? 116 : 132)));
      setLayout(previous => previous.columns === columns && previous.rows === rows ? previous : { columns, rows });
    };
    const observer = new ResizeObserver(measure); observer.observe(node); measure();
    return () => observer.disconnect();
  }, [horizontal]);
  useLayoutEffect(() => {
    setPage(0);
    viewport.current?.scrollTo({ left: 0, behavior: 'instant' });
  }, [search, horizontal, layout.columns, layout.rows, entries.length]);
  useEffect(() => {
    const node = viewport.current;
    if (!horizontal || !node) return;
    let accumulated = 0, lastEvent = 0, lastTurn = 0;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || pageCount <= 1) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastEvent > 180) accumulated = 0;
      lastEvent = now;
      if (now - lastTurn < 450) return;
      const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1);
      if (Math.sign(accumulated) !== Math.sign(delta)) accumulated = 0;
      accumulated += delta;
      if (Math.abs(accumulated) < 30) return;
      const index = Math.round(node.scrollLeft / node.clientWidth) + Math.sign(accumulated);
      node.scrollTo({ left: Math.max(0, Math.min(pageCount - 1, index)) * node.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      accumulated = 0; lastTurn = now;
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [horizontal, pageCount]);
  useEffect(() => {
    const node = viewport.current;
    if (!horizontal || !node || pageCount <= 1) return;
    let gesture: { id: number; x: number; left: number; page: number } | undefined;
    const finish = (cancel = false) => {
      if (!gesture) return;
      const start = gesture;
      gesture = undefined;
      const distance = node.scrollLeft - start.left;
      const target = cancel ? start.page : Math.abs(distance) >= Math.min(80, node.clientWidth * .15)
        ? start.page + Math.sign(distance) : start.page;
      node.classList.remove('is-mouse-paging');
      if (node.hasPointerCapture(start.id)) node.releasePointerCapture(start.id);
      node.scrollTo({ left: Math.max(0, Math.min(pageCount - 1, target)) * node.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || gesture || (event.target as Element).closest('button,input,a,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault();
      document.dispatchEvent(new Event('mac-tooltip-dismiss'));
      const left = node.scrollLeft;
      node.scrollTo({ left, behavior: 'instant' });
      gesture = { id: event.pointerId, x: event.clientX, left, page: Math.round(left / node.clientWidth) };
      node.classList.add('is-mouse-paging');
      node.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      node.scrollLeft = gesture.left + gesture.x - event.clientX;
    };
    const up = (event: PointerEvent) => { if (event.pointerId === gesture?.id) { move(event); finish(); } };
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => {
      if (gesture && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up); node.addEventListener('pointercancel', cancel); node.addEventListener('lostpointercapture', cancel);
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); window.addEventListener('keydown', key, true);
    return () => {
      cancel();
      node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', cancel); node.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); window.removeEventListener('keydown', key, true);
    };
  }, [horizontal, pageCount, search, layout.columns, layout.rows]);
  return <MacDialog backdropClassName={`launchpad-overlay${horizontal ? ' launchpad-horizontal' : ''}`} className={horizontal ? 'launchpad-content' : 'launchpad-content mac-scroll-area'} aria-label={category ? `分类 ${category.name}` : '启动台'} onClose={onClose} ownedElementIds={NAVIGATION_MENU_IDS}
    onKeyDown={event => {
      if (activeKey && event.key === 'Escape') { event.preventDefault(); return; }
      if (activeKey || event.defaultPrevented || !horizontal || event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]')) return;
      const direction = { ArrowLeft: -1, ArrowRight: 1, PageUp: -1, PageDown: 1 }[event.key];
      if (direction) { event.preventDefault(); goToPage(page + direction); }
    }}>
      <MacButton className="launchpad-close" aria-label="关闭启动台" onClick={onClose}><X size={20} aria-hidden="true" /></MacButton>
      {category && <header className="launchpad-category-heading"><h2>{category.name}</h2></header>}
      <label className="launchpad-search"><Search size={16} /><MacInput autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={category ? '搜索分类中的网站' : '搜索'} aria-label={category ? '搜索分类网站' : '搜索启动台'} /></label>
      <DndContext sensors={sensors} collisionDetection={collision} autoScroll={!horizontal} onDragStart={({ active }) => {
        setHasDragged(true); setActiveKey(String(active.id)); document.dispatchEvent(new Event('mac-tooltip-dismiss'));
      }} onDragCancel={finishDrag} onDragEnd={async ({ active, over }) => {
        if (over && overlayItem.current) release.current = { key: String(active.id), rect: overlayItem.current.getBoundingClientRect() };
        finishDrag();
        if (!over || active.id === over.id) return;
        const from = keys.indexOf(String(active.id)), to = keys.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        const next = arrayMove(movable, from, to);
        const groups = new Map<string | null, CategorySiteOrder>();
        for (const entry of movable) {
          if (entry.kind !== 'site') continue;
          const { id, categoryId } = entry.item;
          const group = groups.get(categoryId) ?? { categoryId, previousIds: [], ids: [] };
          group.previousIds.push(id);
          groups.set(categoryId, group);
        }
        for (const entry of next) {
          if (entry.kind === 'site') groups.get(entry.item.categoryId)!.ids.push(entry.item.id);
        }
        const changed = [...groups.values()].filter(group => group.ids.some((id, i) => id !== group.previousIds[i]));
        const nextKeys = next.map(entry => entry.key);
        if (changed.length) {
          setPendingOrder(nextKeys);
          try {
            if (!await onSiteOrder(changed)) return;
          } finally { setPendingOrder(null); }
        }
        if (!category) setOrder(nextKeys);
      }}>
      <SortableContext items={keys} strategy={rectSortingStrategy}>
      <div ref={gridHost} className="launchpad-grid-host" data-has-dragged={hasDragged || undefined}>
      {horizontal ? <>
        <div className="launchpad-pages" ref={viewport} tabIndex={0} aria-label="启动台分页" onScroll={event => { const node = event.currentTarget; setPage(Math.max(0, Math.min(pageCount - 1, Math.round(node.scrollLeft / Math.max(1, node.clientWidth))))); }}>
          {Array.from({ length: pageCount }, (_, index) => <div key={index} className="launchpad-page launchpad-grid" data-drag-grid={!!activeKey && showDragGrid || undefined} inert={index !== page} role="group" aria-label={`第 ${index + 1} 页`} style={{ '--launchpad-columns': layout.columns, '--launchpad-rows': layout.rows } as CSSProperties}>
            {entries.slice(index * pageSize, (index + 1) * pageSize)}
            {!entries.length && <p className="launchpad-empty">{search ? '没有找到匹配的网站' : '这个分类还没有网站'}</p>}
          </div>)}
        </div>
        <nav className="launchpad-pagination" aria-label="启动台翻页">
          <div className="launchpad-page-dots">{Array.from({ length: pageCount }, (_, index) => <MacButton key={index} aria-label={`转到第 ${index + 1} 页`} aria-current={index === page ? 'page' : undefined} onClick={() => goToPage(index)}><span /></MacButton>)}</div>
        </nav>
      </> : <div className="launchpad-grid" data-drag-grid={!!activeKey && showDragGrid || undefined}>{entries}</div>}
      </div>
      </SortableContext>
      <DragOverlay dropAnimation={null} className="launchpad-drag-overlay">{active && <div ref={overlayItem} className="launchpad-item"><LaunchpadArtwork entry={active} /></div>}</DragOverlay>
      </DndContext>
      {!horizontal && category && !entries.length && <p className="launchpad-empty">{search ? '没有找到匹配的网站' : '这个分类还没有网站'}</p>}
  </MacDialog>;
}
