import type { NavigationData, SessionActivity, User } from '../../../src/types';
import { readPageMetadata } from './capture';
import { identity, normalizeBase, permissionOrigin, safeURL, type Draft, type Message, type Session, type State } from './model';

const menuId = 'qiangmacnav-save';
const init = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);

function installMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: menuId, title: '收藏进导航', contexts: ['page', 'selection', 'link', 'image', 'video', 'audio'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
}
chrome.runtime.onInstalled.addListener(installMenu);
chrome.runtime.onStartup.addListener(installMenu);

// An action with a default popup does not deliver onClicked. Enable the usual
// anchored popup only once the configured host is already accessible.
async function updateActionPopup() {
  const { base } = await chrome.storage.local.get<{ base?: string }>('base');
  const allowed = base && await chrome.permissions.contains({ origins: [permissionOrigin(base)] });
  await chrome.action.setPopup({ popup: allowed ? 'index.html' : '' });
}
chrome.runtime.onInstalled.addListener(updateActionPopup);
chrome.runtime.onStartup.addListener(updateActionPopup);
chrome.permissions.onAdded.addListener(updateActionPopup);
chrome.permissions.onRemoved.addListener(updateActionPopup);
chrome.storage.local.onChanged.addListener(changes => { if (changes.base) void updateActionPopup(); });

// Use the Chrome API callback in the click event to carry its user gesture
// across a cold worker start. A denied prompt still opens the requested UI.
function requestEntryAccess(): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.get('base', ({ base }) => {
      if (!base || typeof base !== 'string') return resolve();
      chrome.permissions.request({ origins: [permissionOrigin(base)] }).then(() => resolve(), () => resolve());
    });
  });
}
chrome.action.onClicked.addListener(tab => {
  void requestEntryAccess().then(() => chrome.windows.create({
    url: chrome.runtime.getURL(`index.html?sourceTab=${tab.id ?? ''}`), type: 'popup', width: 420, height: 520,
  }));
});

class APIError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function api<T>(base: string, path: string, token = '', body?: unknown): Promise<T> {
  if (!await chrome.permissions.contains({ origins: [permissionOrigin(base)] })) throw new Error('请允许访问导航地址后再试。');
  let response: Response;
  try {
    response = await fetch(`${base}/api/extension${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(body !== undefined && path === '/sites' ? '收藏结果未确认，请刷新导航列表确认是否已保存，再决定是否重试。' : '无法连接导航，请检查地址、网络、HTTPS 证书和服务状态。');
  }
  let data: any;
  try { data = await response.json(); } catch { throw new Error('服务未返回 JSON，请确认已部署支持插件的后端版本。'); }
  if (!response.ok) throw new APIError(data.error || `请求失败（${response.status}）`, response.status);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('导航服务返回了无效数据。');
  return data as T;
}

async function getSession(): Promise<Session | undefined> { return (await chrome.storage.local.get<{ session?: Session }>('session')).session; }
async function authenticated<T>(session: Session, path: string, body?: unknown): Promise<T> {
  try { return await api<T>(session.base, path, session.token, body); }
  catch (error) {
    if (error instanceof APIError && error.status === 401) await chrome.storage.local.remove('session');
    throw error;
  }
}
async function requireSession(expected: string): Promise<Session> {
  const session = await getSession();
  if (!session || identity(session) !== expected) throw new Error('账号已变更，请重新打开窗口后操作。');
  return session;
}

async function reportActivity(session: Session): Promise<SessionActivity> {
  const result = await authenticated<SessionActivity>(session, '/session/activity', {});
  if (!Number.isFinite(result.expiresAt) || !Number.isFinite(result.checkAfterSeconds)) throw new Error('登录续期响应无效。');
  if (result.expiresAt !== session.expiresAt) {
    await chrome.storage.local.set({ session: { ...session, expiresAt: result.expiresAt } });
  }
  return result;
}
const draftKey = (id: string) => `capture:${id}`;
type StoredDraft = { draft: Draft; createdAt: number; saved?: string };

async function openCaptureWindow(query: string, windowId: number) {
  const parent = await chrome.windows.get(windowId).catch(() => undefined);
  const width = Math.min(440, parent?.width || 440), height = Math.min(550, parent?.height || 550);
  const left = parent?.left === undefined ? undefined : Math.round(parent.left + (parent.width - width) / 2);
  const top = parent?.top === undefined ? undefined : Math.round(parent.top + (parent.height - height) / 2);
  const bounds = { width, height, left, top };
  const popup = await chrome.windows.create({ url: chrome.runtime.getURL(`index.html?${query}`), type: 'popup', ...bounds });
  // Some window managers substitute the previous popup's bounds at creation.
  if (popup?.id != null && parent && (popup.left !== left || popup.top !== top || popup.width !== width || popup.height !== height)) {
    await chrome.windows.update(popup.id, bounds).catch(() => undefined);
  }
}

async function capture(tab: chrome.tabs.Tab, selection = '', entryAccess?: Promise<void>) {
  const url = safeURL(tab.url || '');
  if (!url) throw new Error('此页面无法收藏，请在普通 HTTP(S) 网页上使用。');
  const draft: Draft = { url, name: [...(tab.title || new URL(url).hostname)].slice(0, 100).join(''), note: '', logoUrl: safeURL(tab.favIconUrl || '') || new URL('/favicon.ico', url).href };
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: readPageMetadata });
    const result = results[0]?.result;
    if (result) Object.assign(draft, result, { logoUrl: result.logoUrl || draft.logoUrl });
  } catch { draft.warning = '浏览器限制了此页的内容读取，已使用标签页信息；可手动补充图标和备注。'; }
  if (selection) draft.note = [...selection.trim()].slice(0, 500).join('');
  const id = crypto.randomUUID();
  // Temporary drafts survive worker suspension but expire after 24 hours or a browser restart.
  const stored = await chrome.storage.session.get<Record<string, StoredDraft>>(null);
  const expired = Object.keys(stored).filter(key => key.startsWith('capture:') && stored[key].createdAt < Date.now() - 86400000);
  if (expired.length) await chrome.storage.session.remove(expired);
  await chrome.storage.session.set({ [draftKey(id)]: { draft, createdAt: Date.now() } });
  await entryAccess;
  await openCaptureWindow(`capture=${id}`, tab.windowId);
  return id;
}

// Serialize state transitions across popups, collection windows and worker wake-ups.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(() => init).then(work);
  queue = result.catch(() => undefined);
  return result;
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== menuId || !tab) return;
  const access = requestEntryAccess();
  void serial(() => capture(tab, info.selectionText, access)).catch(async () => {
    await access;
    await openCaptureWindow('captureError=1', tab.windowId);
  });
});

async function handle(request: Message): Promise<unknown> {
  switch (request.type) {
    case 'activity': return reportActivity(await requireSession(request.identity));
    case 'configure': {
      const base = normalizeBase(request.base);
      const session = await getSession();
      if (session && session.base !== base) throw new Error('请先退出当前账号再切换导航地址。');
      await chrome.storage.local.set({ base });
      return true;
    }
    case 'login': {
      const base = normalizeBase(request.base);
      if (await getSession()) throw new Error('请先退出当前账号再登录。');
      const result = await api<{ user: User; token: string; expiresAt: number }>(base, '/login', '', { username: request.username.trim(), password: request.password });
      if (!result.user?.id || !['admin', 'user'].includes(result.user.role) || !/^[a-f0-9]{64}$/.test(result.token) || !Number.isFinite(result.expiresAt)) throw new Error('登录响应无效，请升级导航后端。');
      await chrome.storage.local.set({ base, session: { base, ...result } satisfies Session });
      return true;
    }
    case 'logout': {
      const session = await requireSession(request.identity);
      let warning = '';
      try { await authenticated(session, '/logout', {}); }
      catch (error) { if (!(error instanceof APIError && error.status === 401)) warning = '已清除本机登录。服务端退出未确认，可在网页“退出其他设备”中撤销会话。'; }
      await chrome.storage.local.remove('session');
      return { warning };
    }
    case 'state': {
      const local = await chrome.storage.local.get<{ base?: string; session?: Session }>(['base', 'session']);
      const session = local.session as Session | undefined;
      const stored = request.capture ? (await chrome.storage.session.get<Record<string, StoredDraft>>(draftKey(request.capture)))[draftKey(request.capture)] : undefined;
      const state: State = { base: local.base || '', user: null, identity: '', draft: stored?.draft, saved: !!stored?.saved };
      state.needsAccess = !state.base || !await chrome.permissions.contains({ origins: [permissionOrigin(state.base)] });
      if (!session) return state;
      state.user = session.user;
      state.identity = identity(session);
      state.base = session.base;
      if (state.needsAccess) return state;
      try {
        state.user = await authenticated<User>(session, '/session');
        state.navigation = await authenticated<NavigationData>(session, '/navigation');
      } catch (error) {
        state.syncError = error instanceof Error ? error.message : '同步失败，请重试。';
        if (error instanceof APIError && error.status === 401) { state.user = null; state.identity = ''; }
      }
      state.lastCategory = (await chrome.storage.local.get<Record<string, string | null>>(`category:${state.identity}`))[`category:${state.identity}`];
      return state;
    }
    case 'capture': {
      const tab = await chrome.tabs.get(request.tabId);
      if (!tab) throw new Error('没有可收藏的网页。');
      return capture(tab);
    }
    case 'category': {
      const session = await requireSession(request.identity);
      await chrome.storage.local.set({ [`category:${identity(session)}`]: request.categoryId });
      return true;
    }
    case 'save': {
      const session = await requireSession(request.identity);
      const key = draftKey(request.capture);
      const stored = (await chrome.storage.session.get<Record<string, StoredDraft>>(key))[key];
      if (!stored) throw new Error('收藏草稿已过期，请重新右键收藏。');
      if (stored.saved) throw new Error('此页面已收藏，请刷新导航列表。');
      // A temporary renewal failure must not prevent a valid session from saving.
      try { await reportActivity(session); } catch (error) {
        if (error instanceof APIError && error.status === 401) throw error;
      }
      const result = await authenticated<{ id: string }>(session, '/sites', {
        name: request.draft.name, url: request.draft.url, logoUrl: request.draft.logoUrl, note: request.draft.note, categoryId: request.categoryId,
      });
      // Once the server confirms success, a storage failure must not invite another POST.
      let warning = '';
      try {
        await chrome.storage.session.set({ [key]: { ...stored, saved: result.id } });
        await chrome.storage.local.set({ [`category:${identity(session)}`]: request.categoryId });
      } catch { warning = '已收藏，但本地记忆保存失败。'; }
      return { id: result.id, warning };
    }
    case 'discard': await chrome.storage.session.remove(draftKey(request.capture)); return true;
    default: throw new Error('未知插件操作。');
  }
}

chrome.runtime.onMessage.addListener((request: Message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('index.html')) return false;
  void serial(() => handle(request)).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error instanceof Error ? error.message : '操作失败，请重试。' }));
  return true;
});
