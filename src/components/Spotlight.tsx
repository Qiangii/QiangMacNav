import { useContext, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Command, Search, X } from 'lucide-react';
import { openSite } from '../api';
import type { Site } from '../types';
import { SiteIcon } from './SiteIcon';
import { searchSites } from './siteSearch';
import { useSearchInput } from './useSearchInput';
import { MacButton, MacDialog, MacInput, MacScrollArea, MacTooltip } from './ui';
import { DesktopAccountContext, isCachedText, readDesktopCache, useDesktopState, writeDesktopCache } from '../desktopCache';
import { SPOTLIGHT_HISTORY_KEY, readRecentSiteIds, recentSites, rememberSite } from './spotlightHistory';

export function Spotlight({ sites, onClose }: { sites: Site[]; onClose: () => void }) {
  const account = useContext(DesktopAccountContext);
  const [recent, setRecent] = useState(() => readRecentSiteIds(readDesktopCache(account, SPOTLIGHT_HISTORY_KEY)));
  const [query, commitQuery] = useDesktopState('spotlight:query', '', isCachedText);
  const [selectedId, setSelectedId] = useState<string>();
  const { inputProps: searchInput, composing } = useSearchInput(query, value => { commitQuery(value); setSelectedId(undefined); });
  const searching = !!query.trim();
  const results = useMemo(() => searching ? searchSites(sites, query) : recentSites(sites, recent), [searching, query, sites, recent]);
  const selected = results.findIndex(site => site.id === selectedId);
  const resultsRef = useRef<HTMLDivElement>(null);

  function launch(site: Site) {
    // Queue the cache write before closing; reopening can read it even before
    // the shared cache's delayed localStorage flush has completed.
    const saved = readDesktopCache(account, SPOTLIGHT_HISTORY_KEY);
    const next = rememberSite(saved === null ? recent : readRecentSiteIds(saved), site.id);
    writeDesktopCache(account, SPOTLIGHT_HISTORY_KEY, next);
    setRecent(next);
    openSite(site); onClose();
  }

  return <MacDialog backdropClassName="spotlight-overlay" onClose={onClose} className="spotlight-window" aria-label="搜索网站" onKeyDown={event => {
      if (!(event.target instanceof HTMLInputElement) || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, Math.min(results.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
        setSelectedId(results[next]?.id);
        resultsRef.current?.querySelectorAll('.spotlight-result')[next]?.scrollIntoView({ block: 'nearest' });
      }
      const target = results[Math.max(0, selected)];
      if (event.key === 'Enter' && target) { event.preventDefault(); launch(target); }
    }}>
      <div className="spotlight-search"><Search size={23} /><MacInput autoFocus {...searchInput} placeholder="搜索全部网站的标题、链接或备注" aria-label="搜索全部网站" /><MacTooltip content="关闭搜索"><MacButton className="spotlight-close" aria-label="关闭搜索" onClick={onClose}><X size={17} /></MacButton></MacTooltip></div>
      <MacScrollArea ref={resultsRef} className="spotlight-results">
        <div className="spotlight-label" role="status">{searching ? '搜索结果' : '最近访问'}</div>
        {results.map(site => <MacTooltip key={site.id} content={site.note || site.url}><MacButton className={`spotlight-result${site.id === selectedId ? ' selected' : ''}`} data-site-id={site.id} data-search-selected={site.id === selectedId ? 'true' : undefined} aria-label={`打开 ${site.name}`} onPointerMove={event => { if (event.pointerType !== 'touch') setSelectedId(site.id); }} onPointerLeave={() => setSelectedId(undefined)} onFocus={() => setSelectedId(undefined)} onClick={() => launch(site)}>
          <SiteIcon site={site} /><span className="spotlight-result-copy"><strong>{site.name}</strong><small>{site.note || site.url}</small></span><ArrowUpRight size={16} aria-hidden="true" />
        </MacButton></MacTooltip>)}
        {!results.length && <div className="spotlight-no-results">{searching ? '没有找到相关网站' : '暂无最近访问，搜索并打开网站后会显示在这里'}</div>}
      </MacScrollArea>
      <div className="spotlight-footer"><span><Command size={12} /> K</span><span>{searching ? '全部分类 · 标题 / 链接 / 备注' : '最近 20 个站点 · 仅保存在本机'}</span></div>
  </MacDialog>;
}
