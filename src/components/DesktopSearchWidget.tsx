import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { GripVertical, Search } from 'lucide-react';
import type { DesktopSearchConfig } from '../types';
import { isCachedText, useDesktopState } from '../desktopCache';
import { MacButton, MacInput, MacTooltip } from './ui';
import { MacSelect } from './MacSelect';
import { SearchEngineIcon } from './DesktopSearchSettings';
import { useEventCallback } from './useEventCallback';
import { desktopSearchLayout, resizeDesktopSearch, SEARCH_HEIGHT, searchURL, type SearchBounds, type SearchGeometry } from './desktopSearch';
import './desktop-search.css';

export function DesktopSearchWidget({ config, geometry, bounds, busy, onInteractionStart, onInteractionPreview, onInteractionEnd }: {
  config: DesktopSearchConfig; geometry: SearchGeometry; bounds: SearchBounds; busy: boolean;
  onInteractionStart: () => void; onInteractionPreview: (geometry: SearchGeometry) => void; onInteractionEnd: (geometry?: SearchGeometry) => void;
}) {
  const [engineId, setEngineId] = useDesktopState('desktop-search:engine', 'google', isCachedText);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'move' | 'resize'>();
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const blockClickUntil = useRef(0);
  const begin = useEventCallback(onInteractionStart), preview = useEventCallback(onInteractionPreview), finish = useEventCallback(onInteractionEnd);
  const engine = config.engines.find(item => item.id === engineId) ?? config.engines[0];
  useEffect(() => () => cleanup.current?.(), []);
  // Icon rows can change as the widget crosses them; only viewport changes cancel a gesture.
  useEffect(() => { cleanup.current?.(); }, [bounds.width, bounds.height, busy]);

  function start(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    const node = event.currentTarget, target = event.target as HTMLElement;
    if (!node.contains(target) || event.button !== 0 || busy || cleanup.current) return;
    const resizing = !!target.closest('[data-search-resize]');
    if (!resizing && target.closest('input,select,textarea,[role="combobox"],button:not(.desktop-search-handle)')) return;
    event.preventDefault();
    const pointer = event.pointerId, origin = { x: event.clientX, y: event.clientY }, initial = { ...geometry };
    const area = node.closest<HTMLElement>('.desktop-shortcuts');
    let active = false, stopped = false, next = initial, timer: number | undefined;
    const activate = () => {
      if (active || stopped) return;
      active = true; clearTimeout(timer); setMode(resizing ? 'resize' : 'move');
      node.querySelector<HTMLInputElement>('input:focus')?.blur();
      document.dispatchEvent(new Event('mac-tooltip-dismiss'));
      begin(); preview(initial);
    };
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointer || stopped) return;
      // ResizeObserver/React may not have committed the new bounds before pointerup.
      if (area && (area.clientWidth !== bounds.width || area.clientHeight !== bounds.height)) { stop(); return; }
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
      // A short deliberate drag and a stationary long press both activate; small
      // pointer movement before the timer must not permanently cancel the gesture.
      if (!active && Math.hypot(dx, dy) >= 4) activate();
      if (!active) return;
      next = resizing ? resizeDesktopSearch(initial, dx, bounds) : desktopSearchLayout(bounds, { ...initial, x: initial.x + dx, y: initial.y + dy, bounds });
      preview(next);
    };
    const stop = (commit = false) => {
      if (stopped) return;
      stopped = true; clearTimeout(timer); cleanup.current = undefined;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); window.removeEventListener('keydown', key, true); window.removeEventListener('scroll', cancel, true);
      document.removeEventListener('visibilitychange', visibility);
      node.removeEventListener('lostpointercapture', cancelPointer);
      if (node.hasPointerCapture(pointer)) node.releasePointerCapture(pointer);
      if (active) {
        blockClickUntil.current = Date.now() + 350;
        const changed = next.x !== initial.x || next.y !== initial.y || next.width !== initial.width;
        finish(commit && changed ? next : undefined);
      }
      setMode(undefined);
    };
    const end = (event: globalThis.PointerEvent) => { if (event.pointerId === pointer) { move(event); stop(true); } };
    const cancel = () => stop();
    const cancelPointer = (event: globalThis.PointerEvent) => { if (event.pointerId === pointer) stop(); };
    const visibility = () => { if (document.hidden) stop(); };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stop(); } };
    cleanup.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); window.addEventListener('keydown', key, true); window.addEventListener('scroll', cancel, true);
    document.addEventListener('visibilitychange', visibility);
    node.addEventListener('lostpointercapture', cancelPointer);
    node.setPointerCapture(pointer);
    if (resizing) activate(); else timer = window.setTimeout(activate, 250);
  }

  function keyboardAdjust(event: KeyboardEvent<HTMLButtonElement>, resizing = false) {
    if (busy || mode || cleanup.current) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta || resizing && !delta[0]) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 1 : 10;
    const next = resizing ? resizeDesktopSearch(geometry, delta[0] * step, bounds) : desktopSearchLayout(bounds, { ...geometry, x: geometry.x + delta[0] * step, y: geometry.y + delta[1] * step, bounds });
    if (next.x === geometry.x && next.y === geometry.y && next.width === geometry.width) return;
    begin(); finish(next);
  }

  return <div className={`desktop-search-widget${mode ? ` is-${mode === 'move' ? 'dragging' : 'resizing'}` : ''}`} data-desktop-widget="search" data-x={geometry.x} data-y={geometry.y}
    style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: SEARCH_HEIGHT }}
    onPointerDown={start} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onClickCapture={event => { if (mode || Date.now() < blockClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }}>
    <form className="desktop-search-bar" role="search" aria-label="桌面网页搜索" onSubmit={event => {
      event.preventDefault(); if (mode || !engine || busy) return;
      const url = searchURL(engine, query); if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }}>
      <MacTooltip content="拖动搜索框；方向键移动，Shift 精细调整" disabled={!!mode}><MacButton className="desktop-search-handle" aria-label="移动搜索框" disabled={busy} onKeyDown={event => keyboardAdjust(event)}><GripVertical size={14} /></MacButton></MacTooltip>
      <MacSelect label={`搜索引擎${engine ? `：${engine.name}` : ''}`} compact showCheck={false} alignIcons disabled={busy || !!mode || !engine} value={engine?.id ?? ''} options={config.engines.map(item => ({ value: item.id, label: item.name, icon: <SearchEngineIcon engine={item} /> }))} onChange={setEngineId} />
      <MacInput aria-label="网页搜索关键词" value={query} onChange={event => setQuery(event.target.value)} maxLength={2048} disabled={busy || !!mode || !engine} placeholder={engine ? `使用${engine.name}搜索` : '请在应用设置中添加搜索引擎'} />
      <MacTooltip content="搜索"><MacButton className="desktop-search-submit" type="submit" aria-label="搜索网页" disabled={busy || !!mode || !engine || !query.trim()}><Search size={18} /></MacButton></MacTooltip>
    </form>
    <MacButton className="desktop-search-resize desktop-search-resize-edge" data-search-resize aria-label="调整搜索框宽度" disabled={busy} onKeyDown={event => keyboardAdjust(event, true)} />
    <MacButton className="desktop-search-resize desktop-search-resize-corner" data-search-resize aria-label="从右下角调整搜索框宽度" disabled={busy} onKeyDown={event => keyboardAdjust(event, true)} />
  </div>;
}
