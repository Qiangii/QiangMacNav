import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import type { Category, DesktopItem, DesktopSearchConfig, Site } from '../types';
import { useDesktopState } from '../desktopCache';
import { DesktopSearchWidget } from './DesktopSearchWidget';
import { desktopSearchLayout, isSearchGeometry, saveDesktopSearch, searchOccupiedCells, type SavedSearchGeometry, type SearchBounds, type SearchGeometry } from './desktopSearch';
import { message, openSite } from '../api';
import { MediaPreview } from './MediaPreview';
import { SiteIcon } from './SiteIcon';
import { SystemIcon } from './SystemIcon';
import { MacTooltip } from './ui';
import { DESKTOP_CELL_HEIGHT, desktopColumns, desktopVisibleRows, desktopGrid, desktopGroupOffset, desktopKey, moveDesktopGroup, projectDesktopItems } from './desktopGrid';
import { desktopDropBlocked, desktopDropRegions, type DesktopPointer } from './desktopDropZones';
import { useEventCallback } from './useEventCallback';
import { useNavigationIndex } from './useNavigationIndex';
import './desktop-shortcuts.css';

type Grid = ReturnType<typeof desktopGrid>;
type Entry = { item: DesktopItem; site?: Site; category?: Category };
type DragSession = { keys: Set<string>; items: DesktopItem[]; grid: Grid; bounds: SearchBounds; delta: DesktopPointer; pointer?: DesktopPointer };

function DesktopShortcut({ entry, grid, busy, selected, groupOffset, onSelect, onOpen, onMenu, suppressOpen }: {
  entry: Entry; grid: Grid; busy: boolean; selected: boolean;
  groupOffset?: { x: number; y: number; blocked: boolean };
  onSelect: (event?: MouseEvent) => void; onOpen: () => void; onMenu: (event: MouseEvent) => void; suppressOpen: () => boolean;
}) {
  const { item, site, category } = entry;
  const { setNodeRef, attributes, listeners } = useDraggable({ id: desktopKey(item), disabled: busy });
  const isDragging = !!groupOffset;
  const element = useRef<HTMLButtonElement | null>(null);
  const lastDragRect = useRef<DOMRect | undefined>(undefined);
  const dropAnimation = useRef<Animation | undefined>(undefined);
  const left = item.position % grid.columns * grid.cellWidth;
  const top = Math.floor(item.position / grid.columns) * DESKTOP_CELL_HEIGHT;
  const dx = groupOffset?.x ?? 0;
  const dy = groupOffset?.y ?? 0;
  const name = site?.name ?? category?.name ?? '';
  // Commit the new grid coordinates immediately, then animate only the remaining
  // distance from the last rendered drag position. Dnd-kit clears its transform
  // on release, so transitioning left/top would otherwise start at the old cell.
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    if (isDragging) {
      dropAnimation.current?.cancel();
      lastDragRect.current = node.getBoundingClientRect();
    } else if (lastDragRect.current) {
      const from = lastDragRect.current;
      lastDragRect.current = undefined;
      const to = node.getBoundingClientRect();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dropAnimation.current = node.animate([
          { transform: `translate3d(${from.left - to.left}px,${from.top - to.top}px,0)` },
          { transform: 'translate3d(0,0,0)' },
        ], { duration: 180, easing: 'cubic-bezier(.2,.75,.25,1)' });
      }
    }
  }, [isDragging, left, top, dx, dy]);
  useEffect(() => () => dropAnimation.current?.cancel(), []);
  return <MacTooltip content={<>{name}<br />单击打开，拖动排列</>} disabled={busy || isDragging}><button ref={node => { element.current = node; setNodeRef(node); }} type="button" {...attributes} {...listeners}
    className={`desktop-shortcut${selected ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
    style={{ left, top, width: grid.cellWidth, transition: isDragging || lastDragRect.current ? 'none' : undefined, transform: isDragging ? `translate3d(${dx}px,${dy}px,0)` : undefined }}
    data-desktop-key={desktopKey(item)} data-icon-motion={`desktop:${desktopKey(item)}`} data-position={item.position} aria-label={`桌面${site ? '网站' : '分类'} ${name}`} aria-pressed={selected} aria-disabled={busy}
    onFocus={event => { if (event.currentTarget.matches(':focus-visible')) onSelect(); }}
    onClick={event => {
      if (busy || suppressOpen() || event.detail > 1) return;
      onSelect(event);
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onOpen();
    }}
    onKeyDown={event => {
      if (event.key === 'Enter' && !isDragging) { event.preventDefault(); if (!suppressOpen()) onOpen(); return; }
      listeners?.onKeyDown?.(event);
    }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!suppressOpen()) onMenu(event); }}>
    <span className="desktop-shortcut-image">{site ? <SiteIcon site={site} /> : <MediaPreview url={category?.iconUrl} fallback={<SystemIcon src="/assets/icons/folder-icon.png" />} />}</span>
    <span className="desktop-shortcut-name">{name}</span>
  </button></MacTooltip>;
}

export function DesktopShortcuts({ items, sites, categories, searchConfig, layoutColumns, layoutRows, showDragGrid = false, onInitialize, onOpenCategory, onMenu, onRemove, onMove, onError, onDragStart }: {
  items: DesktopItem[]; sites: Site[]; categories: Category[];
  searchConfig: DesktopSearchConfig;
  layoutColumns: number;
  layoutRows: number;
  onInitialize: (columns: number, rows: number) => Promise<void>;
  showDragGrid?: boolean;
  onOpenCategory: (category: Category) => void;
  onMenu: (event: MouseEvent, items: DesktopItem[], remove: () => void) => void;
  onRemove: (items: DesktopItem[]) => Promise<void>;
  onMove: (items: DesktopItem[], columns: number, rows: number) => Promise<void>;
  onError: (error: string) => void; onDragStart: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const { siteById, categoryById } = useNavigationIndex(sites, categories);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mobile, setMobile] = useState(false);
  const initialColumns = useRef(0);
  const initializationStarted = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number }>();
  const selectionCleanup = useRef<(() => void) | undefined>(undefined);
  const [drag, setDrag] = useState<{ keys: Set<string>; offset: ReturnType<typeof desktopGroupOffset> }>();
  const dragSession = useRef<DragSession | undefined>(undefined);
  const [draft, setDraft] = useState<{ items: DesktopItem[]; columns: number; rows: number }>();
  const [busy, setBusy] = useState(false);
  const [searchGeometry, setSearchGeometry] = useDesktopState<SavedSearchGeometry | null>('desktop-search:geometry', null, isSearchGeometry);
  const [searchDrag, setSearchDrag] = useState<SearchGeometry>();
  const searchPlacement = searchDrag ?? desktopSearchLayout(size, searchGeometry);
  const columns = desktopColumns(size.width);
  const reserved = useMemo(() => searchConfig.enabled ? searchOccupiedCells(searchPlacement, { columns, cellWidth: size.width / columns }, DESKTOP_CELL_HEIGHT, mobile) : new Set<number>(), [searchConfig.enabled, searchPlacement.x, searchPlacement.y, searchPlacement.width, columns, size.width, mobile]);
  const locked = useRef(false), blockedUntil = useRef(0);
  const visibleItems = useMemo(() => projectDesktopItems(
    (draft?.items ?? items).filter(item => item.kind === 'site' ? siteById.has(item.id) : categoryById.has(item.id)),
    draft?.columns ?? (layoutColumns || initialColumns.current), columns, desktopVisibleRows(size.height), reserved, draft?.rows ?? layoutRows,
  ), [draft, items, siteById, categoryById, layoutColumns, layoutRows, columns, size.height, reserved]);
  const grid = desktopGrid(size.width, size.height, visibleItems);
  const dragGrid = useRef(grid);
  const dropOffset = useEventCallback((session: DragSession) => {
    const offset = desktopGroupOffset(session.items, session.keys, session.delta, session.grid, reserved);
    const element = area.current;
    if (element && !offset.blocked) {
      const rect = element.getBoundingClientRect();
      const viewport = { left: rect.left, top: rect.top, width: element.clientWidth, height: element.clientHeight, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
      offset.blocked = desktopDropBlocked(session.items, session.keys, offset, session.grid, DESKTOP_CELL_HEIGHT, viewport, desktopDropRegions(), session.pointer);
    }
    return offset;
  });
  const updateDrag = useEventCallback((session: DragSession) => {
    const offset = dropOffset(session);
    setDrag(previous => previous?.keys === session.keys && previous.offset.x === offset.x && previous.offset.y === offset.y && previous.offset.column === offset.column && previous.offset.row === offset.row && previous.offset.blocked === offset.blocked ? previous : { keys: session.keys, offset });
  });
  useEffect(() => {
    // Native pointer coordinates do not include dnd-kit's auto-scroll adjustment.
    // Capture pointerup too, so the final check uses the actual release position.
    const track = (event: globalThis.PointerEvent) => {
      if (event.isPrimary && dragSession.current?.pointer) dragSession.current.pointer = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('pointermove', track, true); window.addEventListener('pointerup', track, true);
    return () => { window.removeEventListener('pointermove', track, true); window.removeEventListener('pointerup', track, true); };
  }, []);
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const update = () => {
      const session = dragSession.current;
      if (!session) return;
      updateDrag(session);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [dragging, updateDrag]);
  useLayoutEffect(() => {
    if (!searchConfig.enabled) { setSearchGeometry(null); setSearchDrag(undefined); }
  }, [searchConfig.enabled, setSearchGeometry]);
  useEffect(() => () => selectionCleanup.current?.(), []);
  useEffect(() => {
    const keys = new Set(items.map(desktopKey));
    setSelected(previous => new Set([...previous].filter(key => keys.has(key))));
  }, [items]);
  function startSelection(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.pointerType !== 'mouse' || locked.current || drag || (event.target as HTMLElement).closest('button,[data-desktop-widget]')) return;
    // Marquee selection prevents the browser's default focus change on pointerdown.
    event.currentTarget.querySelector<HTMLInputElement>('.desktop-search-bar input:focus')?.blur();
    event.preventDefault();
    selectionCleanup.current?.(); onDragStart();
    const element = event.currentTarget;
    const bounds = element.getBoundingClientRect();
    const origin = { x: event.clientX - bounds.left + element.scrollLeft, y: event.clientY - bounds.top + element.scrollTop };
    const previous = new Set(selected), additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const base = additive ? previous : new Set<string>();
    setSelected(base);
    let pointer = { x: event.clientX, y: event.clientY }, frame = 0, moved = false;
    const cells = [...element.querySelectorAll<HTMLButtonElement>('.desktop-shortcut')].map(node => ({ key: node.dataset.desktopKey!, left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight }));
    const update = () => {
      if (moved) {
        const speed = pointer.y < bounds.top + 24 ? -10 : pointer.y > bounds.bottom - 24 ? 10 : 0;
        element.scrollTop += speed;
        const x = Math.max(0, Math.min(element.clientWidth, pointer.x - bounds.left + element.scrollLeft));
        const y = Math.max(0, Math.min(element.scrollHeight, pointer.y - bounds.top + element.scrollTop));
        const box = { left: Math.min(origin.x, x), top: Math.min(origin.y, y), width: Math.abs(x - origin.x), height: Math.abs(y - origin.y) };
        setSelectionBox(box);
        const next = new Set(base);
        for (const cell of cells) if (cell.left < box.left + box.width && cell.left + cell.width > box.left && cell.top < box.top + box.height && cell.top + cell.height > box.top) next.add(cell.key);
        setSelected(next);
      }
      frame = requestAnimationFrame(update);
    };
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      pointer = { x: next.clientX, y: next.clientY };
      moved ||= Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) > 3;
    };
    const stop = () => {
      cancelAnimationFrame(frame); setSelectionBox(undefined);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', stop); window.removeEventListener('resize', stop); window.removeEventListener('keydown', key);
      selectionCleanup.current = undefined;
    };
    const end = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      if (next.type === 'pointerup') { move(next); cancelAnimationFrame(frame); update(); }
      stop();
    };
    const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); setSelected(previous); stop(); } };
    selectionCleanup.current = stop;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    window.addEventListener('blur', stop); window.addEventListener('resize', stop); window.addEventListener('keydown', key);
    frame = requestAnimationFrame(update);
  }
  function menu(event: MouseEvent, item?: DesktopItem) {
    if (suppressOpen()) { event.preventDefault(); event.stopPropagation(); return; }
    const keys = item && !selected.has(desktopKey(item)) ? new Set([desktopKey(item)]) : selected;
    const targets = visibleItems.filter(entry => keys.has(desktopKey(entry)));
    if (!item && targets.length < 2) return;
    event.preventDefault(); event.stopPropagation(); setSelected(keys);
    onMenu(event, targets, () => { void remove(targets); });
  }
  async function remove(targets: DesktopItem[]) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    const keys = new Set(targets.map(desktopKey));
    try {
      await onRemove(targets);
      setSelected(previous => new Set([...previous].filter(key => !keys.has(key))));
    } catch (reason) { onError(message(reason)); }
    finally { locked.current = false; setBusy(false); }
  }
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const narrow = matchMedia('(max-width: 760px)');
    const measure = () => {
      setMobile(narrow.matches);
      const width = Math.max(1, element.clientWidth);
      const height = element.clientHeight;
      if (!initialColumns.current) initialColumns.current = desktopColumns(width);
      const session = dragSession.current;
      if (session && (session.bounds.width !== width || session.bounds.height !== height)) {
        dragSession.current = undefined; setDrag(undefined); blockedUntil.current = Date.now() + 350;
      }
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    narrow.addEventListener('change', measure);
    return () => { observer.disconnect(); narrow.removeEventListener('change', measure); };
  }, []);
  useEffect(() => {
    if (layoutColumns || !size.width || initializationStarted.current) return;
    initializationStarted.current = true;
    locked.current = true; setBusy(true);
    void onInitialize(initialColumns.current, desktopVisibleRows(size.height)).catch(reason => onError(message(reason))).finally(() => { locked.current = false; setBusy(false); });
  }, [layoutColumns, size.width, size.height, onInitialize, onError]);
  const coordinates: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
    const delta = { ArrowRight: [dragGrid.current.cellWidth, 0], ArrowLeft: [-dragGrid.current.cellWidth, 0], ArrowDown: [0, DESKTOP_CELL_HEIGHT], ArrowUp: [0, -DESKTOP_CELL_HEIGHT] }[event.code];
    if (!delta) return undefined;
    event.preventDefault();
    return { x: currentCoordinates.x + delta[0], y: currentCoordinates.y + delta[1] };
  };
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: coordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }));
  const suppressOpen = () => locked.current || !!drag || Date.now() < blockedUntil.current;
  async function finish(event: DragEndEvent) {
    blockedUntil.current = Date.now() + 350;
    setDrag(undefined);
    const session = dragSession.current;
    dragSession.current = undefined;
    if (!session || locked.current || area.current?.clientWidth !== session.bounds.width || area.current?.clientHeight !== session.bounds.height) return;
    session.delta = event.delta;
    const offset = dropOffset(session);
    const next = moveDesktopGroup(session.items, session.keys, offset, session.grid.columns);
    if (next === session.items) return;
    const rows = desktopVisibleRows(session.bounds.height);
    locked.current = true; setBusy(true); setDraft({ items: next, columns: session.grid.columns, rows });
    try { await onMove(next, session.grid.columns, rows); }
    catch (reason) { onError(message(reason)); }
    finally { setDraft(undefined); setBusy(false); locked.current = false; }
  }
  return <div ref={area} className={`desktop-shortcuts${drag?.offset.blocked ? ' is-drop-blocked' : ''}`} role="region" aria-label="桌面快捷方式" aria-busy={busy}
    onPointerDown={startSelection} onContextMenu={event => menu(event)}>
    <DndContext sensors={sensors}
      accessibility={{ screenReaderInstructions: { draggable: '按空格开始移动，用方向键选择网格位置，再按空格或回车放置，Esc 取消。回车打开快捷方式。' } }}
      onDragStart={event => {
        const key = String(event.active.id);
        if (!visibleItems.some(item => desktopKey(item) === key)) return;
        const keys = selected.has(key) ? new Set(visibleItems.filter(item => selected.has(desktopKey(item))).map(desktopKey)) : new Set([key]);
        dragGrid.current = grid;
        const session = { keys, items: visibleItems, grid, bounds: size, delta: { x: 0, y: 0 }, pointer: getEventCoordinates(event.activatorEvent) ?? undefined };
        dragSession.current = session;
        updateDrag(session); setSelected(keys); onDragStart();
      }}
      onDragMove={event => { const session = dragSession.current; if (session) { session.delta = event.delta; updateDrag(session); } }}
      onDragCancel={() => { blockedUntil.current = Date.now() + 350; dragSession.current = undefined; setDrag(undefined); }} onDragEnd={event => { void finish(event); }}>
      <div className={`desktop-shortcut-grid${drag && showDragGrid ? ' is-dragging' : ''}`} style={{ height: grid.rows * DESKTOP_CELL_HEIGHT, '--desktop-cell-width': `${grid.cellWidth}px` } as React.CSSProperties}>
        {searchConfig.enabled && size.width > 0 && <DesktopSearchWidget config={searchConfig} geometry={searchPlacement} bounds={size} busy={busy || !!drag}
          onInteractionStart={() => { locked.current = true; setSelected(new Set()); onDragStart(); }} onInteractionPreview={setSearchDrag}
          onInteractionEnd={geometry => { if (geometry) setSearchGeometry(saveDesktopSearch(geometry, size)); setSearchDrag(undefined); locked.current = false; blockedUntil.current = Date.now() + 350; }} />}
        {drag && showDragGrid && dragSession.current?.items.filter(item => drag.keys.has(desktopKey(item))).map(item => <span key={desktopKey(item)} className="desktop-drop-target" aria-hidden="true" style={{ left: (item.position % grid.columns + drag.offset.column) * grid.cellWidth, top: (Math.floor(item.position / grid.columns) + drag.offset.row) * DESKTOP_CELL_HEIGHT, width: grid.cellWidth }} />)}
        {visibleItems.map(item => {
          const site = item.kind === 'site' ? siteById.get(item.id) : undefined;
          const category = item.kind === 'category' ? categoryById.get(item.id) : undefined;
          const key = desktopKey(item);
          return <DesktopShortcut key={key} entry={{ item, site, category }} grid={grid} busy={busy || !!searchDrag} selected={selected.has(key)} groupOffset={drag?.keys.has(key) ? drag.offset : undefined} onSelect={event => setSelected(previous => {
            if (!event) return previous.has(key) ? previous : new Set([key]);
            if (event.ctrlKey || event.metaKey || event.shiftKey) { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; }
            return new Set([key]);
          })} suppressOpen={suppressOpen}
            onOpen={() => site ? openSite(site) : category && onOpenCategory(category)} onMenu={event => menu(event, item)} />;
        })}
        {selectionBox && <div className="desktop-selection-box" style={selectionBox} aria-hidden="true" />}
      </div>
      <span className="desktop-drag-status" role="status">{drag?.offset.blocked ? '此区域不可放置，松开将取消移动' : ''}</span>
    </DndContext>
  </div>;
}
