import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { DesktopAccountContext, flushDesktopCache, restoreDesktop, writeDesktopCache } from './desktopCache';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight, Copy, Folder, FolderPlus, Globe2, LayoutGrid, MoreHorizontal,
   Plus, Search, Settings2, Star, Trash2, X, Monitor,
} from 'lucide-react';
import {
  DndContext, DragOverlay,
  closestCenter, pointerWithin,
  MeasuringStrategy, type CollisionDetection, type DragEndEvent, type DragStartEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove } from '@dnd-kit/sortable';
import { api, ApiError, message, openSite } from './api';
import { AuthScreen } from './components/AuthScreen';
import { ContextMenu, type MenuItem, type MenuState } from './components/ContextMenu';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Dock } from './components/Dock';
import { DEFAULT_DOCK_TOOLS } from './components/dockTools';
import { CategorySection } from './components/CategorySection';
import { CategoryIcon } from './components/CategoryIcon';
import { EditorDialog, type EditorTarget } from './components/EditorDialog';
import { FinderWindow } from './components/FinderWindow';
import { Launchpad } from './components/Launchpad';
import { DEFAULT_DESKTOP_SEARCH } from './components/desktopSearch';
import { SettingsWindow } from './components/SettingsWindow';
import { CategoryPreview, SiteCard } from './components/DragPresentation';
import { useSortLayout } from './components/useSortLayout';
import { Spotlight } from './components/Spotlight';
import { SiteItem } from './components/SortableSite';
import { searchSites } from './components/siteSearch';
import { useSearchInput } from './components/useSearchInput';
import type { Bootstrap, Category, CategorySiteOrder, DesktopItem, DockTool, NavigationData, Preferences, Site, User } from './types';
import { saveLegacySiteOrder } from './legacySiteOrder';
import { WindowSidebar } from './components/WindowSidebar';
import { DEFAULT_BRANDING, useSiteBranding } from './branding';
import { DesktopShortcuts } from './components/DesktopShortcuts';
import { IconAppearanceContext } from './components/IconAppearance';
import { DesktopWallpaper } from './components/DesktopWallpaper';
import { CategorySidebar } from './components/CategorySidebar';
import { SharedBadge } from './components/SharedBadge';
import { MacInput, MacScrollArea, MacTooltip, MacToastHost, dismissNotifications, useNotify, useDesktopWindows, type DesktopWindowMode } from './components/ui';
import { MacPresence } from './components/ui/MacPresence';
import { DesktopThemeContext, TitlebarPositionContext } from './components/ui/WindowPreferences';
import { NavigationDragContext, useNavigationDrag, useNavigationSensors } from './components/navigationDrag';
import { useEventCallback } from './components/useEventCallback';
import { useNavigationSync } from './components/useNavigationSync';
import { useSessionActivity } from './components/useSessionActivity';
import { navigationView, orderedCategories, uncategorizedCategory } from './navigationSelection';
import { useWindowFeedback } from './viewFeedback';
import { IconTransitions } from './components/IconTransitions';
import { useOptimisticNavigation } from './components/useOptimisticNavigation';
import { moveNavigationSite, orderCategorySites, orderDesktop, orderDock, orderSidebar } from './navigationOrder';

type ConfirmTarget = { title: string; description: string; action: () => Promise<void> };
const desktopWindowDefaults = { finder: 'visible', settings: 'closed' } satisfies Record<string, DesktopWindowMode>;
const dockWindows = { home: 'finder', settings: 'settings' } as const;

const preferredCollision: CollisionDetection = args => {
  const category = String(args.active.id).startsWith('category:');
  const filtered = { ...args, droppableContainers: args.droppableContainers.filter(container => category ? String(container.id).startsWith('category:') && String(container.id) !== 'category:none' : !String(container.id).startsWith('category:')) };
  const collisions = args.pointerCoordinates ? pointerWithin(filtered) : closestCenter(filtered);
  const site = collisions.find(hit => String(hit.id).startsWith('site:'));
  return site ? [site] : collisions;
};

export default function App() {
  useWindowFeedback();
  const notify = useNotify();
  const [phase, setPhase] = useState<'boot' | 'auth' | 'desktop' | 'failed'>('boot');
  const [bootError, setBootError] = useState('');
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  useSiteBranding(bootstrap);
  const [user, setUser] = useState<User | null>(null);
  useSessionActivity(phase === 'desktop' && user ? user.id : '', api.sessionActivity);
  const { data, setData, saving: savingSort, queue: sortQueue } = useOptimisticNavigation();
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const preferencesBusy = useRef(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [query, commitQuery] = useState('');
  const { inputProps: searchInput, setQuery } = useSearchInput(query, commitQuery);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const editorBusy = useRef(false);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const windows = useDesktopWindows(desktopWindowDefaults);
  const finder = windows.window('finder'), settingsWindow = windows.window('settings');
  const finderOpen = finder.open, finderMinimized = finder.minimized;
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [launchpadOpen, setLaunchpadOpen] = useState(false);
  const [desktopCategoryId, setDesktopCategoryId] = useState<string | null>(null);
  useLayoutEffect(dismissNotifications, [phase, windows.focused, finder.visible, settingsWindow.visible, selectedCategory, launchpadOpen, spotlightOpen, desktopCategoryId]);
  const [activeDrag, setActiveDrag] = useState<string | null>(null);
  const [draft, setDraft] = useState<NavigationData | null>(null);
  const draftRef = useRef<NavigationData | null>(null);
  const [dragColumns, setDragColumns] = useState<string>();
  const layoutRef = useSortLayout([(draft ?? data)?.categories, (draft ?? data)?.sites, (draft ?? data)?.sidebarOrder, phase, selectedCategory, query, finderOpen, finderMinimized]);
  const searchRef = useRef<HTMLInputElement>(null);
  const sessionVersion = useRef(0);
  const dragInteraction = useNavigationDrag(data?.preferences.navigationDragMode ?? 'handle');
  const sensors = useNavigationSensors(dragInteraction.mode);
  const view = useMemo(() => navigationView(data, draft ?? data, selectedCategory), [data, draft ?? data, selectedCategory]);
  const shortcutCategories = useMemo(() => [...(data?.categories ?? []), uncategorizedCategory], [data?.categories]);
  const searching = !!query.trim();
  const searchResults = useMemo(() => searchSites(data?.sites ?? [], query), [data?.sites, query]);
  useNavigationSync(data, setData, phase === 'desktop' && !activeDrag && !savingSort && !preferencesSaving && !editor && !confirm);

  async function refresh() {
    return sortQueue.refresh();
  }
  async function refreshBootstrap() { setBootstrap(await api.bootstrap()); }

  async function refreshAfterChange(success: string, version = sessionVersion.current) {
    if (version !== sessionVersion.current) return;
    try { await refresh(); if (version === sessionVersion.current) notify(success); }
    catch { if (version === sessionVersion.current) notify(`${success}，但列表刷新失败，请刷新页面`, 'error'); }
  }

  async function savePreferences(value: Preferences, success = '设置已保存', errorContext?: string) {
    const notifyError = (reason: unknown) => notify(errorContext ? `${errorContext}：${message(reason)}` : message(reason), 'error');
    if (preferencesBusy.current) { const error = new Error('设置正在保存，请稍后重试'); notifyError(error); throw error; }
    preferencesBusy.current = true;
    setPreferencesSaving(true);
    const version = sessionVersion.current;
    try {
      const saved = await api.preferences(value);
      if (version === sessionVersion.current) { setData(previous => previous ? { ...previous, preferences: saved } : previous); notify(success); }
    } catch (reason) { if (version === sessionVersion.current) notifyError(reason); throw reason;
    } finally { preferencesBusy.current = false; setPreferencesSaving(false); }
  }

  const hideDockTool = useEventCallback(async (tool: DockTool) => {
    if (!data || preferencesBusy.current || document.querySelector('[aria-busy="true"]')) return;
    try { await savePreferences({ ...data.preferences, dockTools: (data.preferences.dockTools ?? DEFAULT_DOCK_TOOLS).filter(id => id !== tool) }, 'Dock 图标已隐藏'); }
    catch { /* savePreferences owns the error notification. */ }
  });

  function restoreWorkspace(account: User, navigation: NavigationData) {
    const saved = restoreDesktop(account, navigation);
    setSelectedCategory(saved.selectedCategory); setQuery(saved.query);
    windows.restore(saved.windows);
    setSpotlightOpen(saved.spotlightOpen); setLaunchpadOpen(saved.launchpadOpen); setEditor(saved.editor);
    setConfirm(null); setMenu(null); editorBusy.current = false;
    setDesktopCategoryId(null);
  }
  useLayoutEffect(() => {
    if (phase !== 'desktop' || !user) return;
    const target = editor ? { kind: editor.kind,
      id: editor.kind === 'site' ? editor.site?.id : editor.category?.id,
      categoryId: editor.kind === 'site' ? editor.categoryId : undefined } : null;
    writeDesktopCache(user.id, 'workspace', { selectedCategory, query, windows: windows.state,
      spotlightOpen, launchpadOpen, editor: target });
  }, [phase, user?.id, selectedCategory, query, windows.state, spotlightOpen, launchpadOpen, editor]);

  async function initialize() {
    const version = ++sessionVersion.current;
    setData(null);
    setPhase('boot'); setBootError('');
    try {
      const [initial, account] = await Promise.all([api.bootstrap(), api.session().catch(reason => {
        if (reason instanceof ApiError && reason.status === 401) return null;
        throw reason;
      })]);
      if (version !== sessionVersion.current) return;
      setBootstrap(initial);
      try {
        if (!account) { setPhase('auth'); return; }
        setUser(account);
        const navigation = await refresh();
        if (version !== sessionVersion.current) return;
        restoreWorkspace(account, navigation);
        setPhase('desktop');
      } catch (reason) {
        if (version !== sessionVersion.current) return;
        if (!(reason instanceof ApiError && reason.status === 401)) throw reason;
        setPhase('auth');
      }
    } catch (reason) { if (version === sessionVersion.current) { setBootError(message(reason)); setPhase('failed'); } }
  }

  async function signedIn(account: User) {
    const version = ++sessionVersion.current;
    setData(null);
    setUser(account);
    try {
      const navigation = await refresh();
      if (version === sessionVersion.current) {
        restoreWorkspace(account, navigation); setPhase('desktop');
      }
    } catch (reason) {
      if (version === sessionVersion.current) { setBootError(message(reason)); setPhase('failed'); }
    }
  }

  async function logout() {
    flushDesktopCache();
    const version = ++sessionVersion.current;
    windows.restore();
    setUser(null);
    setData(null);
    setPhase('boot');
    try {
      await api.logout();
    } catch (reason) {
      if (!(reason instanceof ApiError && reason.status === 401)) {
        if (version === sessionVersion.current) { setBootError(`退出登录失败：${message(reason)}`); setPhase('failed'); }
        return;
      }
    }
    if (version !== sessionVersion.current) return;
    try { await refreshBootstrap(); } catch { /* Keep the last known registration setting while offline. */ }
    if (version === sessionVersion.current) setPhase('auth');
  }

  useEffect(() => { void initialize(); }, []);
  useEffect(() => {
    const preventF12 = (event: KeyboardEvent) => {
      if (event.key === 'F12' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', preventF12, true);
    return () => window.removeEventListener('keydown', preventF12, true);
  }, []);
  useEffect(() => {
    const deleted = (event: Event) => {
      const url = (event as CustomEvent<string>).detail;
      setUser(previous => previous && previous.avatarUrl === url ? { ...previous, avatarUrl: '' } : previous);
      setData(previous => previous ? { ...previous,
        preferences: { ...previous.preferences,
          ...(previous.preferences.wallpaperUrl === url ? { wallpaperUrl: '', wallpaperMime: '' } : {}),
          ...(previous.preferences.desktopSearch ? { desktopSearch: { ...previous.preferences.desktopSearch, engines: previous.preferences.desktopSearch.engines.map(engine => engine.iconUrl === url ? { ...engine, iconUrl: '' } : engine) } } : {}),
        },
        categories: previous.categories.map(category => category.iconUrl === url ? { ...category, iconUrl: '' } : category),
        sites: previous.sites.map(site => site.logoUrl === url ? { ...site, logoUrl: '' } : site),
      } : previous);
    };
    window.addEventListener('harbor-media-deleted', deleted);
    return () => window.removeEventListener('harbor-media-deleted', deleted);
  }, []);
  useEffect(() => {
    const expired = () => {
      ++sessionVersion.current; setUser(null); setData(null); windows.restore();
      setEditor(null); setConfirm(null); setMenu(null); setSpotlightOpen(false); setLaunchpadOpen(false);
      setPhase('auth'); void refreshBootstrap().catch(() => {});
    };
    window.addEventListener('harbor-session-expired', expired);
    return () => window.removeEventListener('harbor-session-expired', expired);
  }, []);
  useLayoutEffect(() => {
    if (phase === 'desktop' && view && selectedCategory !== view.selectedCategory) setSelectedCategory(view.selectedCategory);
  }, [phase, view?.selectedCategory, selectedCategory]);
  useEffect(() => {
    setActiveDrag(null); setDraft(null); draftRef.current = null;
  }, [selectedCategory, query, phase, finderOpen, finderMinimized]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && phase === 'desktop') { event.preventDefault(); toggleTool('search'); }
      if (event.key === 'Escape' && !event.defaultPrevented) setMenu(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [phase, editor, confirm, spotlightOpen, launchpadOpen]);

  async function perform(action: () => Promise<unknown>, success: string) {
    const version = sessionVersion.current;
    try { await action(); await refreshAfterChange(success, version); }
    catch (reason) { if (version === sessionVersion.current) notify(message(reason), 'error'); }
  }
  const closeMenu = useEventCallback(() => setMenu(null));
  const openSettings = () => windows.open('settings');
  function toggleTool(tool: 'home' | 'launchpad' | 'search' | 'settings' | 'add') {
    if (editorBusy.current || confirm || document.querySelector('[aria-busy="true"]')) return;
    document.dispatchEvent(new Event('mac-tooltip-dismiss'));
    setMenu(null);
    const visible = { launchpad: launchpadOpen, search: spotlightOpen, add: !!editor };
    setDesktopCategoryId(null);
    setLaunchpadOpen(tool === 'launchpad' && !visible.launchpad);
    setSpotlightOpen(tool === 'search' && !visible.search);
    if (tool in dockWindows) windows.toggle(dockWindows[tool as keyof typeof dockWindows]);
    setEditor(null);
    if (tool === 'add' && !visible.add) {
      setEditor({ kind: 'site' });
    }
  }
  const showMenu = (event: MouseEvent | React.KeyboardEvent, items: MenuItem[]) => {
    event.preventDefault(); event.stopPropagation();
    document.dispatchEvent(new Event('mac-tooltip-dismiss'));
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const pointer = event.type === 'contextmenu' && 'clientX' in event ? event : null;
    setMenu({ x: pointer ? pointer.clientX : rect.right - 16, y: pointer ? pointer.clientY : rect.bottom + 4, items });
  };
  const showSiteMenu = useEventCallback((event: MouseEvent | React.KeyboardEvent, site: Site) => showMenu(event, siteMenuItems(site)));
  const showCategoryMenu = useEventCallback((event: MouseEvent, category: Category) => showMenu(event, categoryMenuItems(category)));

  if (phase === 'boot' || phase === 'failed') return <div className="boot-screen">
    <img className="boot-apple" src="/assets/boot-apple.svg" alt="Apple" />
    <div className="boot-progress"><span /></div>
    {phase === 'failed' && <div className="boot-failed"><p>无法连接到导航服务</p><small>{bootError}</small><button onClick={initialize}>重试</button></div>}
  </div>;
  if (phase === 'auth' && bootstrap) return <AuthScreen bootstrap={bootstrap} onRefresh={refreshBootstrap} onSuccess={signedIn} />;
  if (!user || !data || !view) return null;

  const canEdit = view.activeCategory?.editable ?? true;
  const sidebarCategories = orderedCategories(data);
  const sidebarEntries = sidebarCategories.map(c => ({ id: c.id, name: c.name, iconUrl: c.iconUrl, shared: c.shared }));
  const orderedIDs = sidebarEntries.map(entry => entry.id);
  const canSort = canEdit && !query.trim();
  const { activeCategory, categories, allSites, selectedCategory: visibleCategory } = view;
  const desktopCategory = shortcutCategories.find(category => category.id === desktopCategoryId);
  const finderCategoryTitle = searching ? '搜索结果' : activeCategory?.name ?? (visibleCategory === 'uncategorized' ? '未分类' : '我的导航');

  function deleteSite(site: Site) {
    setConfirm({ title: `删除“${site.name}”？`, description: '该网站会从导航、Dock 和桌面快捷方式中移除，此操作无法撤销。', action: async () => { const version = sessionVersion.current; await api.deleteSite(site.id); await refreshAfterChange('网站已删除', version); } });
  }
  function deleteCategory(category: Category) {
    setConfirm({ title: `删除“${category.name}”？`, description: '只能删除空分类。请先移动或删除其中的网站。', action: async () => { const version = sessionVersion.current; await api.deleteCategory(category.id); await refreshAfterChange('分类已删除', version); } });
  }
  function desktopShortcutAction(kind: DesktopItem['kind'], id: string): MenuItem {
    const shortcut = data!.desktopItems?.find(item => item.kind === kind && item.id === id);
    if (shortcut) return { label: '从桌面移除', icon: <X size={15} />, action: () => void perform(() => api.removeDesktopItems([shortcut]), '已从桌面移除') };
    return { label: '添加到桌面', icon: <Monitor size={15} />, action: () => void perform(() => api.addDesktopItem(kind, id), '已添加到桌面') };
  }
  function siteMenuItems(site: Site, dock = false): MenuItem[] {
    const editable = site.editable;
    const pinned = data!.dockItems.some(item => item.kind === 'site' && item.id === site.id);
    const destinations = [
      { id: null, name: '未分类', label: '未分类' },
      ...sidebarCategories.filter(c => c.editable).map(c => ({ id: c.id, name: c.name, label: c.name + (c.shared ? ' · 共享' : '') })),
    ];
    return [
      { label: '打开网站', icon: <ArrowUpRight size={15} />, action: () => { openSite(site); closeCategoryLaunchpad(); } },
      { label: '复制链接', icon: <Globe2 size={15} />, action: () => { void navigator.clipboard.writeText(site.url).then(() => notify('链接已复制')).catch(() => notify('复制失败', 'error')); } },
      { separator: true },
      { label: '编辑网站', icon: <Settings2 size={15} />, disabled: !editable, action: () => setEditor({ kind: 'site', site }) },
      { label: pinned ? '取消固定' : '固定到 Dock', icon: <Star size={15} />, action: () => void perform(() => pinned ? api.unpin(site.id) : api.pin(site.id), pinned ? '已取消 Dock 固定' : '已固定到 Dock') },
      desktopShortcutAction('site', site.id),
      ...(!dock ? [
        { label: '移动到分类', icon: <LayoutGrid size={15} />, disabled: !editable, children: destinations.map(({ id, label }) => ({
          label, checked: site.categoryId === id, action: () => void perform(() => api.moveSite(site.id, id), '网站已移动'),
        })) },
        { label: '复制到分类', icon: <Copy size={15} />, children: destinations.map(({ id, name, label }) => ({
          label, action: () => void perform(() => api.copySite(site.id, id), `网站已复制到“${name}”`),
        })) },
      ] : []),
      { separator: true },
      { label: '删除网站', icon: <Trash2 size={15} />, disabled: !editable, action: () => deleteSite(site) },
    ];
  }

  function openCategory(category: Category) {
    if (editorBusy.current || confirm) return;
    setDesktopCategoryId(null);
    setEditor(null); setSpotlightOpen(false); setLaunchpadOpen(false); setMenu(null);
    windows.open('finder');
    setSelectedCategory(category.id);
    setQuery('');
    window.setTimeout(() => document.getElementById(`category-${category.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
  }
  function categoryMenuItems(category: Category, dock = false): MenuItem[] {
    const editable = category.editable;
    const pinned = data!.dockItems.some(item => item.kind === 'category' && item.id === category.id);
    const shortcuts: MenuItem[] = [
      { label: pinned ? '取消固定' : '固定到 Dock', icon: <Star size={15} />, action: () => void perform(() => pinned ? api.unpinCategory(category.id) : api.pinCategory(category.id), pinned ? '已取消 Dock 固定' : '已固定到 Dock') },
      desktopShortcutAction('category', category.id),
    ];
    const open: MenuItem[] = dock ? [{ label: '打开分类', icon: <Folder size={15} />, action: () => openCategoryLaunchpad(category) }, { separator: true }] : [];
    if (category.id === uncategorizedCategory.id) return [...open, ...shortcuts];
    return [
      ...open,
      { label: '在此添加网站', icon: <Plus size={15} />, disabled: !editable, action: () => setEditor({ kind: 'site', categoryId: category.id }) },
      { separator: true },
      { label: '编辑分类', icon: <Settings2 size={15} />, disabled: !editable, action: () => setEditor({ kind: 'category', category }) },
      ...(user!.role === 'admin' && editable ? [{ label: category.shared ? '取消共享' : '共享分类', icon: <Globe2 size={15} />, action: () => void perform(() => api.setCategorySharing(category.id, !category.shared), category.shared ? '分类已取消共享' : '分类已共享，全站用户可见') }] : []),
      ...shortcuts,
      { label: '删除分类', icon: <Trash2 size={15} />, disabled: !editable, action: () => deleteCategory(category) },
    ];
  }

  function showSidebarMenu(event: MouseEvent | React.KeyboardEvent, id: string) {
    const category = shortcutCategories.find(item => item.id === id);
    if (category) showMenu(event, categoryMenuItems(category));
  }

  function desktopMenu(event: MouseEvent, items: DesktopItem[], remove: () => void) {
    if (items.length > 1) {
      showMenu(event, [{ label: '从桌面移除', icon: <X size={15} />, action: remove }]);
      return;
    }
    const item = items[0];
    if (!item) return;
    const site = item.kind === 'site' ? data!.sites.find(site => site.id === item.id) : undefined;
    const category = item.kind === 'category' ? shortcutCategories.find(category => category.id === item.id) : undefined;
    showMenu(event, [
      { label: site ? '打开网站' : '打开分类', icon: <ArrowUpRight size={15} />, action: () => { if (site) openSite(site); else if (category) openCategoryLaunchpad(category); } },
      { separator: true },
      { label: '从桌面移除', icon: <X size={15} />, action: remove },
    ]);
  }

  function openCategoryLaunchpad(category: Category) {
    if (editorBusy.current || confirm) return;
    setMenu(null); setEditor(null); setSpotlightOpen(false); setLaunchpadOpen(false);
    setDesktopCategoryId(category.id);
  }
  function closeCategoryLaunchpad() {
    setMenu(null); setDesktopCategoryId(null); setLaunchpadOpen(false);
  }

  function blankMenu(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const dialog = target.closest('[role="dialog"], [role="alertdialog"]');
    const inFinder = dialog?.classList.contains('finder-window');
    const onDesktop = !dialog && (target === event.currentTarget || !!target.closest('.desktop-shortcuts, .desktop-wallpaper'));
    if (!inFinder && !onDesktop) { setMenu(null); return; }
    if (target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
    const prepare = () => windows.open('finder');
    showMenu(event, [
      { label: '添加网站', icon: <Plus size={15} />, action: () => { prepare(); setEditor({ kind: 'site' }); } },
      { label: '新建分类', icon: <FolderPlus size={15} />, action: () => { prepare(); setEditor({ kind: 'category' }); } },
      { separator: true },
      { label: '系统设置', icon: <Settings2 size={15} />, action: openSettings },
    ]);
  }

  function clearDrag() { dragInteraction.end(); setActiveDrag(null); setDraft(null); draftRef.current = null; }
  function onDragStart(event: DragStartEvent) {
    if (!canSort) return;
    dragInteraction.begin();
    const grid = document.getElementById(`category-${String(event.active.id).slice(9)}`)?.querySelector('.site-grid');
    setDragColumns(grid ? getComputedStyle(grid).gridTemplateColumns : undefined);
    draftRef.current = data;
    setDraft(data); setActiveDrag(String(event.active.id)); setMenu(null);
  }
  function onDragOver(event: DragOverEvent) {
    const current = draftRef.current;
    if (!current || !event.over) return;
    const source = String(event.active.id), target = String(event.over.id);
    if (source === target) return;
    let next = current;
    if (source.startsWith('category:') && target.startsWith('category:')) {
      const list = orderedCategories(current);
      const from = list.findIndex(c => c.id === source.slice(9)), to = list.findIndex(c => c.id === target.slice(9));
      if (from < 0 || to < 0) return;
      const ordered = arrayMove(list, from, to);
      next = { ...current, sidebarOrder: ordered.map(category => category.id) };
    } else if (source.startsWith('site:')) {
      const moving = current.sites.find(s => s.id === source.slice(5));
      const targetSite = current.sites.find(s => `site:${s.id}` === target);
      if (!moving?.editable || targetSite && !targetSite.editable) return;
      if (!targetSite && !target.startsWith('drop:')) return;
      const destination = targetSite ? targetSite.categoryId : target.slice(5) === 'none' ? null : target.slice(5);
      if (destination !== null && !current.categories.some(c => c.id === destination && c.editable)) return;
      const list = current.sites.filter(s => s.categoryId === destination).sort((a, b) => a.position - b.position);
      const oldIndex = list.findIndex(s => s.id === moving.id);
      const targetIndex = targetSite ? list.findIndex(s => s.id === targetSite.id) : list.length;
      const ordered = list.filter(s => s.id !== moving.id);
      ordered.splice(Math.min(targetIndex, ordered.length), 0, { ...moving, categoryId: destination });
      if (oldIndex === targetIndex) return;
      const positions = new Map(ordered.map((site, index) => [site.id, index]));
      next = { ...current, sites: current.sites.map(s => { const position = positions.get(s.id); return position === undefined || s.categoryId === destination && s.position === position ? s : { ...s, categoryId: destination, position }; }) };
    }
    draftRef.current = next; setDraft(next);
  }
  function queueSort(apply: (snapshot: NavigationData) => NavigationData, save: (before: NavigationData, after: NavigationData, isCurrent: () => boolean) => Promise<unknown>, success = '排序已保存') {
    sortQueue.enqueue({ apply, save, onSuccess: () => notify(success),
      onError: reason => notify(`${message(reason)}，相关未保存排序已撤销`, 'error'),
      onRefreshError: () => notify(`${success}，但列表刷新失败，请刷新页面`, 'error') });
  }
  function saveSidebarOrder(ids: string[]) {
    queueSort(snapshot => orderSidebar(snapshot, ids), () => api.reorder({ kind: 'sidebar', ids }), '分类顺序已保存');
  }
  function saveLaunchpadSiteOrder(groups: CategorySiteOrder[]) {
    queueSort(snapshot => orderCategorySites(snapshot, groups), (before, _after, isCurrent) => before.supportsCategorySiteOrder
      ? api.reorder({ kind: 'categorySites', groups }) : saveLegacySiteOrder(groups, isCurrent));
  }
  function onDragEnd(event: DragEndEvent) {
    const result = draftRef.current;
    const source = String(event.active.id);
    clearDrag();
    if (!event.over || !result || !canSort) return;
    if (source.startsWith('category:')) {
      const ids = result.sidebarOrder;
      if (ids.join() === orderedIDs.join()) return;
      saveSidebarOrder(ids);
    } else if (source.startsWith('site:')) {
      const id = source.slice(5);
      const moving = result.sites.find(s => s.id === id);
      if (!moving?.editable) return;
      const index = result.sites.filter(s => s.categoryId === moving.categoryId).sort((a, b) => a.position - b.position).findIndex(s => s.id === id);
      const original = data!.sites.filter(s => s.categoryId === moving.categoryId).sort((a, b) => a.position - b.position);
      if (original.findIndex(s => s.id === id) === index) return;
      queueSort(snapshot => moveNavigationSite(snapshot, id, moving.categoryId, index), () => api.reorder({ kind: 'sites', siteId: id, categoryId: moving.categoryId, index }));
    }
  }

  return <DesktopAccountContext.Provider key={user.id} value={user.id}><IconAppearanceContext.Provider value={data.preferences}><DesktopThemeContext.Provider value={data.preferences.theme}><TitlebarPositionContext.Provider value={data.preferences.titlebarPosition ?? 'left'}><NavigationDragContext.Provider value={dragInteraction}><div data-navigation-drag-mode={dragInteraction.mode} className={`desktop theme-${data.preferences.theme}`} onContextMenu={blankMenu}>
    <div className="desktop-scene">
    <DesktopWallpaper preferences={data.preferences} />
    <DesktopShortcuts key={user.id} items={data.desktopItems ?? []} sites={data.sites} categories={shortcutCategories} searchConfig={data.preferences.desktopSearch ?? DEFAULT_DESKTOP_SEARCH} layoutColumns={data.desktopColumns ?? 0} layoutRows={data.desktopRows ?? 0} showDragGrid={data.preferences.desktopDragGrid ?? false} onOpenCategory={openCategoryLaunchpad} onMenu={desktopMenu}
      onInitialize={async (columns, rows) => { const version = sessionVersion.current; await api.initializeDesktopLayout(columns, rows); if (version === sessionVersion.current) await refresh(); }}
      onRemove={async items => { const version = sessionVersion.current; await api.removeDesktopItems(items); await refreshAfterChange(items.length > 1 ? `已移除 ${items.length} 个桌面快捷方式` : '已从桌面移除', version); }}
      onMove={(items, columns, rows) => queueSort(snapshot => orderDesktop(snapshot, items, columns, rows), (before, after) => api.saveDesktopLayout(after.desktopItems, columns, rows, before.desktopItems, before.desktopColumns, before.desktopRows), '桌面布局已保存')}
      onError={error => notify(error, 'error')} onDragStart={() => setMenu(null)} />
    <MacToastHost />
    <MacPresence open={finder.visible} keepMounted={finder.open}><FinderWindow focused={finder.focused} zIndex={finder.zIndex} hidden={!finder.visible} onFocusWindow={finder.onFocusWindow} onClose={finder.onClose} onMinimize={finder.onMinimize}>
      <div className="finder-layout">
        <WindowSidebar><aside className="finder-sidebar" aria-label="导航侧边栏">
          <div className="finder-sidebar-heading">分类</div>
          <CategorySidebar entries={sidebarEntries} selected={visibleCategory}
            onSelect={id => { const category = sidebarCategories.find(c => c.id === id); if (category) openCategory(category); }}
            onMenu={showSidebarMenu}
            onReorder={saveSidebarOrder} />
          {data.sites.some(s => !s.categoryId) && <button className={`finder-sidebar-item ${visibleCategory === uncategorizedCategory.id ? 'selected' : ''}`}
            onClick={() => { setSelectedCategory(uncategorizedCategory.id); setQuery(''); }} onContextMenu={event => showSidebarMenu(event, uncategorizedCategory.id)}
            onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') showSidebarMenu(event, uncategorizedCategory.id); }}
            aria-label="未分类" aria-haspopup="menu" aria-current={visibleCategory === uncategorizedCategory.id ? 'page' : undefined} title="未分类"><Folder size={17} /><span>未分类</span></button>}
        </aside></WindowSidebar>
        <div className="finder-content">
          <div className="finder-filterbar">
            <div className="finder-category-heading" data-icon-motion={!searching && activeCategory ? `category:${activeCategory.id}` : undefined} onContextMenu={!searching && activeCategory ? event => { event.stopPropagation(); showSidebarMenu(event, activeCategory.id); } : undefined}>
              {searching ? <Search className="category-mark" size={19} aria-hidden="true" /> : <CategoryIcon className="category-mark" size={19} url={activeCategory?.iconUrl} />}
              <MacTooltip content={finderCategoryTitle}><h2>{finderCategoryTitle}</h2></MacTooltip>
              {!searching && activeCategory?.shared && <SharedBadge />}
              {!searching && visibleCategory && <MacTooltip content="分类操作"><button className="icon-button section-more" aria-label={`${finderCategoryTitle} 的操作`} aria-haspopup="menu" onClick={event => showSidebarMenu(event, visibleCategory)}><MoreHorizontal size={18} /></button></MacTooltip>}
            </div>
            <div className="finder-filter-actions"><label className="finder-search"><Search size={15} /><MacInput ref={searchRef} {...searchInput} placeholder="搜索全部网站" aria-label="搜索全部网站" />{searchInput.value && <MacTooltip content="清除搜索"><button aria-label="清除搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={14} /></button></MacTooltip>}</label><MacTooltip content="新建分类"><button className="finder-tool-button" aria-label="新建分类" onClick={() => setEditor({ kind: 'category' })}><FolderPlus size={17} /></button></MacTooltip><button className="finder-add" aria-label="添加网站" onClick={() => setEditor({ kind: 'site', categoryId: activeCategory?.editable ? activeCategory.id : undefined })}><Plus size={17} /><span>添加网站</span></button></div>
          </div>
          <MacScrollArea key={searching ? `search:${query.trim()}` : visibleCategory} className="finder-scroll" cacheKey={searching ? undefined : `finder:${visibleCategory}`} ref={layoutRef}>
            {searching ? (searchResults.length ? <section className="category-section"><div className="site-grid" role="list" aria-label="网站搜索结果">
              {searchResults.map(site => <SiteItem key={site.id} site={site} onOpen={openSite} onMenu={showSiteMenu} />)}
            </div></section> : <div className="workspace-empty"><Search size={32} /><h2>没有找到相关网站</h2><p>请尝试其他标题、链接或备注关键词</p></div>) :
            <DndContext sensors={sensors} measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }} collisionDetection={preferredCollision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={clearDrag}>
              <SortableContext items={activeCategory ? [`category:${activeCategory.id}`] : []} strategy={() => null}>
                {visibleCategory && <CategorySection key={visibleCategory} category={activeCategory ?? null} showHeading={false} sites={allSites} canEdit={canEdit} sortingDisabled={!canSort} activeDrag={activeDrag} onOpen={openSite} onCategoryMenu={showCategoryMenu} onSiteMenu={showSiteMenu} />}
              </SortableContext>
              {categories.length === 0 && allSites.length === 0 && <div className="workspace-empty"><span className="empty-symbol"><Folder size={46} fill="currentColor" strokeWidth={1.2} /></span><h2>我的导航</h2><p>这里还没有网站或分类</p>{canEdit && <button className="finder-empty-action" onClick={() => setEditor({ kind: 'category' })}><FolderPlus size={16} /> 新建分类</button>}</div>}
              {/* The draft already occupies the final slot. A second drop animation
                  would fly toward an obsolete source rect during cross-list moves. */}
              {createPortal(<div data-navigation-drag-mode={dragInteraction.mode} className={`sort-overlay-theme theme-${data.preferences.theme}`}><DragOverlay zIndex={200} adjustScale={false} dropAnimation={null}>{activeDrag && <div className="sort-overlay" aria-hidden="true">{activeDrag.startsWith('site:') ? <SiteCard site={data.sites.find(s => s.id === activeDrag.slice(5))!} /> : <CategoryPreview columns={dragColumns} category={data.categories.find(c => c.id === activeDrag.slice(9))!} sites={data.sites.filter(s => s.categoryId === activeDrag.slice(9)).sort((a, b) => a.position - b.position)} />}</div>}</DragOverlay></div>, document.body)}
            </DndContext>}
          </MacScrollArea>
          <div className="finder-status"><span>{searching ? `${searchResults.length} 个匹配网站` : `${allSites.length} 个网站 · ${categories.length} 个分类`}</span><span>{searching ? '全部分类' : activeCategory?.shared ? '共享分类' : '个人空间'}</span></div>
        </div>
      </div>
    </FinderWindow></MacPresence>
    <MacPresence open={settingsWindow.visible} keepMounted={settingsWindow.open}><SettingsWindow branding={bootstrap ?? DEFAULT_BRANDING} onBranding={value => setBootstrap(previous => previous ? { ...previous, ...value } : previous)} focused={settingsWindow.focused && !launchpadOpen && !desktopCategory && !spotlightOpen && !editor} zIndex={settingsWindow.zIndex} onFocusWindow={settingsWindow.onFocusWindow} user={user} onUser={setUser} preferences={data.preferences} preferencesSaving={preferencesSaving} hidden={!settingsWindow.visible} onClose={settingsWindow.onClose} onMinimize={settingsWindow.onMinimize} onPreferences={savePreferences} onRegistration={refreshBootstrap} onLogout={logout} /></MacPresence>
    </div>
    <Dock items={data.dockItems} sites={data.sites} categories={shortcutCategories} tools={data.preferences.dockTools} onToolMenu={(event, tool) => showMenu(event, [{ label: '隐藏', disabled: preferencesSaving || !!document.querySelector('[aria-busy="true"]'), action: () => { void hideDockTool(tool); } }])} canEdit={true} onSiteMenu={(event, s) => showMenu(event, siteMenuItems(s, true))} onCategoryMenu={(event, c) => showMenu(event, categoryMenuItems(c, true))} onOpenCategory={openCategoryLaunchpad} onSettings={() => toggleTool('settings')} onSearch={() => toggleTool('search')} onHome={() => toggleTool('home')} onAdd={() => toggleTool('add')} onReorder={ids => queueSort(snapshot => orderDock(snapshot, ids), () => api.reorder({ kind: 'pins', ids }), 'Dock 顺序已保存')} />
    <MacPresence open={launchpadOpen}><Launchpad categories={data.categories} sites={data.sites} scrollMode={data.preferences.launchpadScrollMode} showDragGrid={data.preferences.desktopDragGrid ?? false} onSiteOrder={saveLaunchpadSiteOrder} onCategory={openCategoryLaunchpad} onSiteMenu={showSiteMenu} onClose={closeCategoryLaunchpad} /></MacPresence>
    <MacPresence open={!!desktopCategory}>{desktopCategory && <Launchpad key={desktopCategory.id} category={desktopCategory} categories={[]} sites={data.sites} scrollMode={data.preferences.launchpadScrollMode} showDragGrid={data.preferences.desktopDragGrid ?? false} onSiteOrder={saveLaunchpadSiteOrder} onCategory={openCategoryLaunchpad} onSiteMenu={showSiteMenu} onClose={closeCategoryLaunchpad} />}</MacPresence>
    <MacPresence open={spotlightOpen}><Spotlight sites={data.sites} onClose={() => setSpotlightOpen(false)} /></MacPresence>
    {menu && <ContextMenu key={`${menu.x}-${menu.y}-${menu.items.length}`} menu={menu} onClose={closeMenu} restoreFocus={!!desktopCategory || launchpadOpen} />}
    <MacPresence open={!!editor}>{editor && <EditorDialog key={`${editor.kind}-${editor.kind === 'site' ? editor.site?.id ?? editor.categoryId ?? 'new' : editor.category?.id ?? 'new'}`} target={editor} categories={data.categories} onBusyChange={busy => { editorBusy.current = busy; }} onSave={async () => { await refresh(); }} onClose={() => { if (!editorBusy.current) setEditor(null); }} />}</MacPresence>
    <MacPresence open={!!confirm}>{confirm && <ConfirmDialog title={confirm.title} description={confirm.description} onConfirm={confirm.action} onClose={() => setConfirm(null)} />}</MacPresence>
    <IconTransitions data={data} />
  </div></NavigationDragContext.Provider></TitlebarPositionContext.Provider></DesktopThemeContext.Provider></IconAppearanceContext.Provider></DesktopAccountContext.Provider>;
}
