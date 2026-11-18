import type { Category, NavigationData, User } from '../../../src/types';

export type Draft = { name: string; url: string; logoUrl: string; note: string; warning?: string };
export type Session = { base: string; token: string; user: User; expiresAt: number };
export type State = { base: string; user: User | null; identity: string; needsAccess?: boolean; navigation?: NavigationData; lastCategory?: string | null; draft?: Draft; saved?: boolean; syncError?: string };
export type Message =
  | { type: 'state'; capture?: string }
  | { type: 'activity'; identity: string }
  | { type: 'configure'; base: string }
  | { type: 'login'; base: string; username: string; password: string }
  | { type: 'logout'; identity: string }
  | { type: 'capture'; tabId: number }
  | { type: 'category'; identity: string; categoryId: string | null }
  | { type: 'save'; identity: string; capture: string; draft: Draft; categoryId: string | null }
  | { type: 'discard'; capture: string };

export function normalizeBase(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入完整导航地址，例如 https://nav.example.com'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('导航地址须为 HTTP(S) 域名或 IP（可带端口），不包含路径、账号或参数。');
  }
  return url.origin;
}

export function safeURL(value: string, base?: string): string {
  if (!value.trim()) return '';
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048 ? url.href : '';
  } catch { return ''; }
}

export function identity(session: Session): string { return JSON.stringify([session.base, session.user.id]); }
export function permissionOrigin(base: string): string { const url = new URL(base); return `${url.protocol}//${url.hostname}/*`; }
export function orderedCategories(data: Pick<NavigationData, 'categories' | 'sidebarOrder'>): Category[] {
  const rank = new Map(data.sidebarOrder.map((id, index) => [id, index]));
  return [...data.categories].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.position - b.position || a.id.localeCompare(b.id));
}
export function defaultCategory(categories: Category[], last: string | null | undefined): string | null {
  if (last === null) return null;
  if (last && categories.some(c => c.editable && c.id === last)) return last;
  return categories.find(c => c.editable)?.id ?? null;
}

export async function message<T>(request: Message): Promise<T> {
  const result = await chrome.runtime.sendMessage(request);
  if (!result?.ok) throw new Error(result?.error || '插件后台未响应，请重新打开插件。');
  return result.value as T;
}
