import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { BookmarkPlus, Check, ExternalLink, Folder, LogOut, RefreshCw, Search, Upload } from 'lucide-react';
import type { Category, Site, SessionActivity } from '../../../src/types';
import { useSessionActivity } from '../../../src/components/useSessionActivity';
import { MacSelect } from '../../../src/components/MacSelect';
import { MacButton } from '../../../src/components/ui/MacButton';
import { MacInput, MacTextarea } from '../../../src/components/ui/MacInput';
import '../../../src/theme-tokens.css';
import { PASSWORD_LENGTH_HINT, PASSWORD_PLACEHOLDER, USERNAME_HINT, USERNAME_PLACEHOLDER, validPasswordLength, validUsername } from '../../../src/accountValidation';
import { defaultCategory, message, normalizeBase, orderedCategories, permissionOrigin, safeURL, type Draft, type Session, type State } from './model';
import './style.css';
import { isMediaPath, loadLogo, uploadLogoFromURL } from './media';
import { currentFeedbackVisit, dismissNotifications, useViewFeedback, useWindowFeedback } from '../../../src/viewFeedback';

const params = new URLSearchParams(location.search);
const captureId = params.get('capture') || undefined;
const captureError = params.has('captureError');
document.documentElement.dataset.window = captureId || captureError || params.has('sourceTab') ? 'standalone' : 'toolbar';
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const composing = (event: React.KeyboardEvent) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); };

function Logo({ src, state, name }: { src: string; state: State; name: string }) {
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<{ path: string; url: string }>();
  useEffect(() => {
    setFailed(false);
    if (!isMediaPath(src)) return;
    const controller = new AbortController();
    let url: string;
    loadLogo(state.identity, src, controller.signal).then(blob => {
      if (!controller.signal.aborted) {
        url = URL.createObjectURL(blob);
        setPreview({ path: src, url });
      }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [src, state.identity]);
  const url = isMediaPath(src) ? preview?.path === src && preview.url : safeURL(src, state.base);
  return url && !failed ? <img className="site-icon" src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="site-icon fallback" aria-hidden="true">{[...name][0] || 'Q'}</span>;
}

function Login({ base, needsAccess, signedIn, refresh }: { base: string; needsAccess: boolean; signedIn: boolean; refresh: () => Promise<void> }) {
  const [address, setAddress] = useState(base), [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useViewFeedback(''), [field, setField] = useViewFeedback('');
  const [editingAddress, setEditingAddress] = useState(false);
  const connecting = needsAccess || editingAddress;
  useLayoutEffect(dismissNotifications, [connecting]);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (base) setAddress(base); }, [base]);
  const clear = () => { setError(''); setField(''); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (connecting) {
      clear();
      let normalized: string;
      try { normalized = normalizeBase(address); } catch (error) { setError(errorText(error)); setField('address'); form.current?.querySelector<HTMLInputElement>('#address')?.focus(); return; }
      setBusy(true);
      try {
        const [granted] = await Promise.all([
          chrome.permissions.request({ origins: [permissionOrigin(normalized)] }),
          message({ type: 'configure', base: normalized }),
        ]);
        if (!granted) throw new Error('尚未获得访问权限，可再次申请。');
        setEditingAddress(false);
        await refresh();
      } catch (error) { setError(errorText(error)); }
      finally { setBusy(false); }
      return;
    }
    const invalid = !validUsername(username.trim()) ? 'username' : !validPasswordLength(password) ? 'password' : '';
    if (invalid) { setField(invalid); setError(invalid === 'username' ? USERNAME_HINT : PASSWORD_LENGTH_HINT); form.current?.querySelector<HTMLInputElement>(`#${invalid}`)?.focus(); return; }
    setBusy(true); clear();
    try {
      await message({ type: 'login', base, username, password });
      setPassword('');
      await refresh();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <section className="login" aria-label={connecting ? '导航访问权限' : '账号登录'}>
    <form ref={form} onSubmit={submit} onKeyDown={composing} className="editor-form">
      <fieldset disabled={busy}>
        <div className="field-label"><label htmlFor="address">导航地址</label>{!signedIn && !connecting && <MacButton className="text-button" onClick={() => { setEditingAddress(true); clear(); }}>更改</MacButton>}</div>
        <MacInput id="address" name="server" type="url" autoComplete="url" placeholder="https://nav.example.com" readOnly={signedIn || !connecting} value={connecting ? address : base} onChange={e => { setAddress(e.target.value); clear(); }} aria-invalid={field === 'address'} aria-describedby={error ? 'login-error' : undefined} />
        {!connecting && <><label htmlFor="username">账号</label><MacInput id="username" name="username" autoComplete="username" placeholder={USERNAME_PLACEHOLDER} value={username} onChange={e => { setUsername(e.target.value); clear(); }} aria-invalid={field === 'username'} aria-describedby={error ? 'login-error' : undefined} />
        <label htmlFor="password">密码</label><MacInput id="password" name="password" type="password" autoComplete="current-password" placeholder={PASSWORD_PLACEHOLDER} value={password} onChange={e => { setPassword(e.target.value); clear(); }} aria-invalid={field === 'password'} aria-describedby={error ? 'login-error' : undefined} />
        </>}
        {error && <p id="login-error" role="alert" className="mac-field-error">{error}</p>}
        <MacButton variant="primary" type="submit" className={connecting ? undefined : 'login-submit'}>{connecting ? busy ? '等待授权…' : '允许访问导航' : busy ? '正在登录…' : '登录并同步'}</MacButton>
      </fieldset>
    </form>
  </section>;
}

function categoryOptions(categories: Category[], forSaving = false) {
  const options = categories.map(category => ({
    value: category.id, label: category.name + (category.shared ? category.editable ? ' · 已共享' : ' · 共享只读' : ''),
    disabled: forSaving && !category.editable, icon: <Folder size={13} />,
  }));
  return [...options, { value: '', label: '未分类', disabled: false, icon: <Folder size={13} /> }];
}

const siteBatch = 30;
function SiteList({ sites, state }: { sites: Site[]; state: State }) {
  const [limit, setLimit] = useState(siteBatch);
  const list = useRef<HTMLUListElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);
  const hasMore = limit < sites.length;
  useEffect(() => {
    if (!hasMore || !sentinel.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setLimit(count => count + siteBatch);
    }, { root: list.current, rootMargin: '0px 0px 80px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [limit, hasMore]);
  return <ul ref={list} className="site-list" aria-label="站点列表">
    {sites.slice(0, limit).map(site => <li key={site.id}><a href={safeURL(site.url) || undefined} target="_blank" rel="noopener noreferrer"><Logo src={site.logoUrl} state={state} name={site.name} /><span className="site-content"><strong>{site.name}</strong><small>{site.note || site.url}</small></span><span className="arrow" aria-hidden="true">↗</span></a></li>)}
    {hasMore && <li className="list-sentinel" ref={sentinel} aria-hidden="true"/>}
  </ul>;
}

function Navigation({ state }: { state: State }) {
  const data = state.navigation!;
  const categories = orderedCategories(data);
  const [selected, setSelected] = useState(categories[0]?.id || ''), [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useLayoutEffect(dismissNotifications, [selected]);
  const inComposition = useRef(false);
  useEffect(() => { if (selected && !categories.some(c => c.id === selected)) setSelected(categories[0]?.id || ''); }, [data]);
  const needle = search.trim().toLocaleLowerCase();
  const sites = data.sites.filter(s => needle ? [s.name, s.url, s.note].some(value => value.toLocaleLowerCase().includes(needle)) : (s.categoryId || '') === selected);
  return <section className="navigation">
    <div className="search-box"><Search size={15} aria-hidden="true"/><MacInput className="search" type="search" aria-label="搜索全部可见站点" placeholder="搜索站点、网址或备注" value={query} onCompositionStart={() => { inComposition.current = true; }} onCompositionEnd={e => { inComposition.current = false; setSearch(e.currentTarget.value); }} onChange={e => { setQuery(e.target.value); if (!inComposition.current) setSearch(e.target.value); }} /></div>
    <MacSelect label="分类" value={selected} options={categoryOptions(categories)} onChange={setSelected} disabled={!!needle} />
    <div className="list-heading"><strong>{needle ? '搜索结果' : categories.find(c => c.id === selected)?.name || '未分类'}</strong><span>{sites.length} 个站点</span></div>
    <SiteList key={JSON.stringify([selected, needle])} sites={sites} state={state} />
    {!sites.length && <div className="empty">{needle ? '没有找到匹配的站点' : '这里还没有站点，试试右键“收藏进导航”。'}</div>}
  </section>;
}

function Collection({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const categories = orderedCategories(state.navigation!);
  const [draft, setDraft] = useState<Draft>(state.draft || { name: '', url: '', logoUrl: '', note: '' });
  const [category, setCategory] = useState<string | null>(() => defaultCategory(categories, state.lastCategory));
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(state.saved), [error, setError] = useViewFeedback(''), [field, setField] = useViewFeedback(''), [notice, setNotice] = useViewFeedback('');
  const [secondsLeft, setSecondsLeft] = useState(3);
  useEffect(() => {
    if (!saved) return;
    const closesAt = Date.now() + 3000;
    const tick = window.setInterval(() => {
      const remaining = Math.ceil((closesAt - Date.now()) / 1000);
      if (remaining <= 0) {
        window.clearInterval(tick);
        window.close();
      } else {
        setSecondsLeft(remaining);
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [saved]);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (category && !categories.some(c => c.id === category && c.editable)) { setCategory(defaultCategory(categories, undefined)); setNotice('原分类已不可用，已重新选择可收藏分类。'); } }, [state.navigation]);
  function change(key: keyof Draft, value: string) { setDraft(d => ({ ...d, [key]: value })); setError(''); setField(''); }
  function selectCategory(value: string) {
    const id = value || null;
    if (id === category) return;
    dismissNotifications();
    const origin = currentFeedbackVisit();
    setCategory(id);
    void message({ type: 'category', identity: state.identity, categoryId: id }).catch(error => setError(errorText(error), origin));
  }
  async function importLogo() {
    if (busy || uploading) return;
    setUploading(true); setNotice(''); setError(''); setField('');
    try {
      const path = await uploadLogoFromURL(state.identity, draft.logoUrl);
      change('logoUrl', path);
      setNotice('已上传到我的图标库。');
    } catch (error) { setField('logoUrl'); setError(errorText(error)); }
    finally { setUploading(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || uploading || saved) return;
    const invalid = !draft.name.trim() || [...draft.name.trim()].length > 100 ? 'name' : !safeURL(draft.url) ? 'url' : draft.logoUrl.trim() && !isMediaPath(draft.logoUrl.trim()) && !safeURL(draft.logoUrl) ? 'logoUrl' : [...draft.note.trim()].length > 500 ? 'note' : '';
    if (invalid) { setField(invalid); setError(({ name: '标题须为 1–100 个字符。', url: '请填写有效的 HTTP(S) 网页链接。', logoUrl: '请上传图标、填写有效的 HTTP(S) 图标链接，或留空。', note: '备注最多 500 个字符。' })[invalid]); form.current?.querySelector<HTMLElement>(`#${invalid}`)?.focus(); return; }
    setBusy(true); setError('');
    try {
      const result = await message<{ warning: string }>({ type: 'save', identity: state.identity, capture: captureId!, draft, categoryId: category });
      setSaved(true); setNotice(result.warning);
      await refresh();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  if (!state.draft) return <div className="empty">收藏草稿已过期，请回到网页重新右键收藏。</div>;
  if (saved) return <section className="success">
    <Check size={32} aria-hidden="true"/>
    <h1>已收藏进导航</h1>
    {state.syncError && <p role="status">已保存，但列表刷新失败，请稍后同步。</p>}
    {notice && <p role="status">{notice}</p>}
    <p role="timer">{secondsLeft} 秒后自动关闭</p>
    <MacButton variant="primary" onClick={() => window.close()}>完成</MacButton>
  </section>;
  return <section className="collection"><h1 className="window-title">收藏进导航</h1>
    <form ref={form} onSubmit={submit} onKeyDown={composing} className="editor-form capture-form">
      <div className="scroll-fields"><fieldset disabled={busy}>
      {draft.warning && <p className="notice" role="status">{draft.warning}</p>}{notice && <p className="notice" role="status">{notice}</p>}
      <label htmlFor="name">标题</label><MacInput id="name" value={draft.name} onChange={e => change('name', e.target.value)} aria-invalid={field === 'name'} aria-describedby={field === 'name' ? 'save-error' : undefined} />
      <label htmlFor="url">链接</label><MacInput id="url" type="url" value={draft.url} onChange={e => change('url', e.target.value)} aria-invalid={field === 'url'} aria-describedby={field === 'url' ? 'save-error' : undefined} />
      <label htmlFor="logoUrl">Logo 链接 <span>可留空</span></label>
      <div className="icon-field"><Logo src={draft.logoUrl} state={state} name={draft.name}/><MacInput id="logoUrl" inputMode="url" disabled={uploading} value={draft.logoUrl} onChange={e => change('logoUrl', e.target.value)} aria-invalid={field === 'logoUrl'} aria-describedby={field === 'logoUrl' ? 'save-error' : undefined} />
        <MacButton disabled={uploading || !draft.logoUrl.trim() || isMediaPath(draft.logoUrl.trim())} title="将当前 Logo 链接的图片存入我的图标库" onClick={importLogo}><Upload size={13}/>{uploading ? '上传中…' : '上传'}</MacButton>
      </div>
      <label htmlFor="note">备注 <span>{[...draft.note].length}/500</span></label><MacTextarea id="note" rows={3} value={draft.note} onChange={e => change('note', e.target.value)} aria-invalid={field === 'note'} aria-describedby={field === 'note' ? 'save-error' : undefined} />
      </fieldset></div>
      <fieldset disabled={busy || uploading} className="capture-bottom">
      {error && <p id="save-error" role="alert" className="mac-field-error">{error}</p>}
      {category && categories.find(c => c.id === category)?.shared && <p className="notice">此分类已共享，收藏后全站已登录用户可见。</p>}
      <div className="bottom-controls"><div className="category-control"><MacSelect label="收藏分类" value={category || ''} options={categoryOptions(categories, true)} disabled={busy} onChange={selectCategory} /></div>
      <div className="form-actions"><MacButton onClick={() => { void message({ type: 'discard', capture: captureId! }).then(() => window.close(), () => window.close()); }}>取消</MacButton><MacButton type="submit" variant="primary" disabled={!!state.syncError}>{busy ? '正在收藏…' : '收藏进导航'}</MacButton></div></div>
    </fieldset></form>
  </section>;
}

function App() {
  useWindowFeedback();
  const [state, setState] = useState<State>({ base: '', user: null, identity: '' });
  const reportActivity = useCallback(() => message<SessionActivity>({ type: 'activity', identity: state.identity }), [state.identity]);
  useSessionActivity(state.needsAccess ? '' : state.identity, reportActivity);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useViewFeedback('');
  const [actionError, setActionError] = useViewFeedback('');
  useLayoutEffect(dismissNotifications, [state.identity, state.needsAccess]);
  const generation = useRef(0);
  const refreshing = useRef<Promise<void> | null>(null), refreshAgain = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    if (refreshing.current) { refreshAgain.current = true; return refreshing.current; }
    const version = ++generation.current;
    const work = (async () => {
      try {
        const next = await message<State>({ type: 'state', capture: captureId });
        if (version !== generation.current) return;
        setState(previous => ({ ...next, navigation: next.navigation || (next.identity && next.identity === previous.identity ? previous.navigation : undefined) }));
        setError('');
      } catch (error) { if (version === generation.current) setError(errorText(error)); }
      finally {
        if (version === generation.current) setLoading(false);
        refreshing.current = null;
        if (refreshAgain.current) { refreshAgain.current = false; void refresh(); }
      }
    })();
    refreshing.current = work;
    return work;
  }, []);
  useEffect(() => {
    void refresh();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes.session) return;
      const previous = changes.session.oldValue as Session | undefined;
      const current = changes.session.newValue as Session | undefined;
      if (previous?.token === current?.token) return;
      ++generation.current; setState(s => ({ base: s.base, user: null, identity: '' })); setLoading(true); void refresh();
    };
    chrome.storage.onChanged.addListener(changed);
    chrome.permissions.onRemoved.addListener(refresh);
    chrome.permissions.onAdded.addListener(refresh);
    return () => {
      chrome.storage.onChanged.removeListener(changed);
      chrome.permissions.onRemoved.removeListener(refresh);
      chrome.permissions.onAdded.removeListener(refresh);
    };
  }, [refresh]);
  const theme = state.navigation?.preferences.theme;
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.className = `theme-${theme || (system.matches ? 'dark' : 'light')}`; };
    apply();
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const sync = () => { if (!busy && document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(sync, 30000);
    window.addEventListener('focus', sync); window.addEventListener('online', sync); document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); window.removeEventListener('focus', sync); window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', sync); };
  }, [busy, refresh]);
  async function action(work: () => Promise<void>) { setBusy(true); setActionError(''); setError(''); try { await work(); } catch (error) { setActionError(errorText(error)); } finally { setBusy(false); } }
  async function openCollection() {
    const source = params.get('sourceTab');
    const tabId = source ? Number(source) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (!tabId) throw new Error('没有可收藏的网页。');
    await message({ type: 'capture', tabId });
    window.close();
  }
  const showNavigation = !captureId && !captureError && !loading && !!state.user && !state.needsAccess;
  return <main className={captureId && !loading && state.user && !state.needsAccess ? 'capture-window' : showNavigation ? 'panel-window browse-window' : 'panel-window'}>
    {showNavigation && <header className="account-bar"><div className="identity"><strong>{state.user.name}</strong><span>@{state.user.username} · {state.user.role === 'admin' ? '管理员' : '普通用户'}</span></div>
      <div className="toolbar"><MacButton variant="primary" disabled={busy} onClick={() => void action(openCollection)}><BookmarkPlus size={14}/>收藏</MacButton><MacButton disabled={busy} onClick={() => void action(refresh)}><RefreshCw size={13}/>同步</MacButton><a href={state.base} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/>官网</a><MacButton aria-label="退出" title="退出登录" disabled={busy} onClick={() => void action(async () => { const result = await message<{ warning: string }>({ type: 'logout', identity: state.identity }); setNotice(result.warning); await refresh(); })}><LogOut size={15}/></MacButton></div></header>}
    {(actionError || error || state.syncError) && <div className="banner" role="alert">{actionError || error || state.syncError}<button disabled={busy} onClick={() => { setActionError(''); void refresh(); }}>重试同步</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {captureError ? <p className="notice">此页面无法读取，请在普通 HTTP(S) 网页上重新右键收藏。</p> : loading ? <p className="empty" role="status">正在连接导航…</p> : !state.user || state.needsAccess ? <Login base={state.base} needsAccess={state.needsAccess ?? !state.base} signedIn={!!state.user} refresh={refresh} /> : <>
      {state.navigation ? captureId ? <Collection key={state.identity} state={state} refresh={refresh} /> : <Navigation key={state.identity} state={state} /> : <p className="empty">暂时无法获取导航数据，请重试同步。</p>}
    </>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
