import { isCachedText, useDesktopState } from '../desktopCache';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { MoreHorizontal, Search } from 'lucide-react';
import { CategoryIcon } from './CategoryIcon';
import { openSite } from '../api';
import type { Category, Preferences, Site } from '../types';
import { SiteIcon } from './SiteIcon';
import { MacButton, MacDialog, MacInput, MacTooltip } from './ui';
import { NAVIGATION_MENU_IDS } from './ContextMenu';
import './launchpad.css';

export function Launchpad({ categories, sites, onCategory, onClose, onSiteMenu, category, scrollMode = 'horizontal' }: {
  categories: Category[];
  sites: Site[];
  onCategory: (category: Category) => void;
  onClose: () => void;
  onSiteMenu: (event: MouseEvent, site: Site) => void;
  category?: Category;
  scrollMode?: Preferences['launchpadScrollMode'];
}) {
  const [query, setQuery] = useDesktopState(category ? `desktop-category:${category.id}:query` : 'launchpad:query', '', isCachedText);
  const search = query.trim().toLocaleLowerCase();
  const filteredCategories = category ? [] : categories.filter(category => category.name.toLocaleLowerCase().includes(search));
  const categorySites = category ? sites.filter(site => site.categoryId === category.id).sort((a, b) => a.position - b.position) : sites;
  const filteredSites = categorySites.filter(site => `${site.name} ${site.note}`.toLocaleLowerCase().includes(search));
  const horizontal = scrollMode === 'horizontal';
  const viewport = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 7, rows: 1 });
  const [page, setPage] = useState(0);
  const pageSize = layout.columns * layout.rows;
  const entries = [
    ...filteredCategories.map((category, index) => <MacTooltip key={`category:${category.id}`} content={category.name}><MacButton className="launchpad-item" style={{ animationDelay: `${Math.min(index, 8) * 22}ms` }} onClick={() => onCategory(category)}>
      <span className="launchpad-folder"><CategoryIcon size={38} url={category.iconUrl} /></span><span>{category.name}</span>
    </MacButton></MacTooltip>),
    ...filteredSites.map((site, index) => <div key={`site:${site.id}`} className="launchpad-site" onContextMenu={event => { event.currentTarget.querySelector<HTMLButtonElement>('.launchpad-item')?.focus({ preventScroll: true }); onSiteMenu(event, site); }}>
      <MacTooltip content={site.note.trim() || site.name}><MacButton className="launchpad-item" style={{ animationDelay: `${Math.min(index + filteredCategories.length, 8) * 22}ms` }} onClick={() => { openSite(site); onClose(); }} onKeyDown={event => {
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.launchpad-site-more')?.click();
        }
      }}>
        <SiteIcon site={site} /><span>{site.name}</span>
      </MacButton></MacTooltip>
      <MacTooltip content="网站操作"><MacButton className="launchpad-site-more" aria-label={`${site.name} 的操作`} aria-haspopup="menu" onClick={event => onSiteMenu(event, site)}><MoreHorizontal size={16} /></MacButton></MacTooltip>
    </div>),
  ];
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
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
  return <MacDialog backdropClassName={`launchpad-overlay mac-scroll-area${horizontal ? ' launchpad-horizontal' : ''}`} className="launchpad-content" aria-label={category ? `分类 ${category.name}` : '启动台'} onClose={onClose} ownedElementIds={NAVIGATION_MENU_IDS}
    onKeyDown={event => {
      if (event.defaultPrevented || !horizontal || event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]')) return;
      const direction = { ArrowLeft: -1, ArrowRight: 1, PageUp: -1, PageDown: 1 }[event.key];
      if (direction) { event.preventDefault(); goToPage(page + direction); }
    }}>
      {category && <header className="launchpad-category-heading"><h2>{category.name}</h2></header>}
      <label className="launchpad-search"><Search size={16} /><MacInput autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={category ? '搜索分类中的网站' : '搜索'} aria-label={category ? '搜索分类网站' : '搜索启动台'} /></label>
      {horizontal ? <>
        <div className="launchpad-pages" ref={viewport} tabIndex={0} aria-label="启动台分页" onScroll={event => { const node = event.currentTarget; setPage(Math.max(0, Math.min(pageCount - 1, Math.round(node.scrollLeft / Math.max(1, node.clientWidth))))); }}>
          {Array.from({ length: pageCount }, (_, index) => <div key={index} className="launchpad-page launchpad-grid" inert={index !== page} role="group" aria-label={`第 ${index + 1} 页`} style={{ '--launchpad-columns': layout.columns, '--launchpad-rows': layout.rows } as CSSProperties}>
            {entries.slice(index * pageSize, (index + 1) * pageSize)}
            {!entries.length && <p className="launchpad-empty">{search ? '没有找到匹配的网站' : '这个分类还没有网站'}</p>}
          </div>)}
        </div>
        <nav className="launchpad-pagination" aria-label="启动台翻页">
          <div className="launchpad-page-dots">{Array.from({ length: pageCount }, (_, index) => <MacButton key={index} aria-label={`转到第 ${index + 1} 页`} aria-current={index === page ? 'page' : undefined} onClick={() => goToPage(index)}><span /></MacButton>)}</div>
        </nav>
      </> : <div className="launchpad-grid">{entries}</div>}
      {!horizontal && category && !filteredSites.length && <p className="launchpad-empty">{search ? '没有找到匹配的网站' : '这个分类还没有网站'}</p>}
  </MacDialog>;
}
