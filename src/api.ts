import type { Bootstrap, NavigationData, Preferences, Site, User, ManagedUser, LoginLog, MediaImage, MediaKind, DesktopItem, SiteBranding, AdminSettings, SystemUpdateStatus, SystemRelease, UpdateJob } from './types';
import type { SessionActivity } from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function request<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
  const multipart = body instanceof FormData;
  const binary = body instanceof Blob;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    signal,
    headers: binary ? { 'Content-Type': 'application/octet-stream' } : !multipart && (body || method !== 'GET') ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'GET' ? undefined : multipart || binary ? body : JSON.stringify(body ?? {}),
  });
  const result: unknown = await response.json().catch(() => null);
  signal?.throwIfAborted();
  if (response.status === 401 && path !== '/session' && !path.startsWith('/auth/')) window.dispatchEvent(new Event('harbor-session-expired'));
  const data = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null;
  if (!response.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : `请求失败 (${response.status})`, response.status);
  if (!data) throw new ApiError('服务器返回了无效数据，请重试', 502);
  return result as T;
}

export const api = {
  sessionActivity: (signal: AbortSignal) => request<SessionActivity>('/session/activity', 'POST', {}, signal),
  systemUpdates: (signal?: AbortSignal) => request<SystemUpdateStatus>('/admin/updates', 'GET', undefined, signal),
  checkSystemUpdates: (signal?: AbortSignal) => request<SystemUpdateStatus>('/admin/updates/check', 'POST', {}, signal),
  installSystemUpdate: (release: SystemRelease) => request<UpdateJob>('/admin/updates/install', 'POST', { version: release.version, digest: release.digest }),
  uploadSystemUpdate: (version: string, file: File) => request<UpdateJob>(`/admin/updates/upload?version=${encodeURIComponent(version)}`, 'POST', file),
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  session: () => request<User>('/session'),
  updateAccount: (name: string) => request<User>('/account', 'PATCH', { name }),
  updateAvatar: (url: string) => request<User>('/account/avatar', 'PUT', { url }),
  media: (page: number, query = '', kind: MediaKind = 'image', signal?: AbortSignal) => request<{ items: MediaImage[]; total: number }>(`/media?page=${page}&kind=${kind}&q=${encodeURIComponent(query)}`, 'GET', undefined, signal),
  deleteMedia: async (id: string) => {
    await request(`/media/${id}`, 'DELETE');
    window.dispatchEvent(new CustomEvent('harbor-media-deleted', { detail: `/api/media/${id}` }));
  },
  uploadImage: (file: File, kind: MediaKind = 'image') => {
    const body = new FormData(); body.append('file', file); body.append('kind', kind);
    return request<MediaImage>('/media', 'POST', body);
  },
  changePassword: (currentPassword: string, newPassword: string) => request('/account/password', 'PUT', { currentPassword, newPassword }),
  revokeOtherSessions: () => request<{ revoked: number }>('/account/sessions', 'DELETE'),
  loginLogs: (admin: boolean, page: number, signal?: AbortSignal) => request<{ items: LoginLog[]; total: number }>(`/${admin ? 'admin' : 'account'}/login-logs?page=${page}`, 'GET', undefined, signal),
  users: (page: number, query: string, signal?: AbortSignal) => request<{ items: ManagedUser[]; total: number }>(`/admin/users?page=${page}&q=${encodeURIComponent(query)}`, 'GET', undefined, signal),
  manageUser: (id: string, value: { name?: string; role?: string; disabled?: boolean; password?: string }) => request(`/admin/users/${id}`, 'PATCH', value),
  deleteUser: (id: string) => request(`/admin/users/${id}`, 'DELETE'),
  login: (username: string, password: string) => request<User>('/auth/login', 'POST', { username, password }),
  register: (name: string, username: string, password: string, setupToken: string) =>
    request<User>('/auth/register', 'POST', { name, username, password, setupToken }),
  logout: () => request<{ ok: boolean }>('/auth/logout', 'POST'),
  navigation: (signal?: AbortSignal) => request<NavigationData>('/navigation', 'GET', undefined, signal),
  createCategory: (name: string, iconUrl = '') => request<{ id: string }>('/categories', 'POST', { name, iconUrl }),
  updateCategory: (id: string, name: string, iconUrl: string) => request(`/categories/${id}`, 'PATCH', { name, iconUrl }),
  deleteCategory: (id: string) => request(`/categories/${id}`, 'DELETE'),
  createSite: (site: Pick<Site, 'name' | 'url' | 'note' | 'logoUrl' | 'categoryId'>) =>
    request<{ id: string }>('/sites', 'POST', site),
  updateSite: (id: string, site: Pick<Site, 'name' | 'url' | 'note' | 'logoUrl' | 'categoryId'>) =>
    request(`/sites/${id}`, 'PUT', site),
  moveSite: (id: string, categoryId: string | null) => request(`/sites/${id}/category`, 'PATCH', { categoryId }),
  copySite: (id: string, categoryId: string | null) => request<{ id: string }>(`/sites/${id}/copy`, 'POST', { categoryId }),
  deleteSite: (id: string) => request(`/sites/${id}`, 'DELETE'),
  setCategorySharing: (id: string, shared: boolean) => request(`/categories/${id}/sharing`, 'PUT', { shared }),
  pin: (id: string) => request(`/pins/${id}`, 'POST'),
  unpin: (id: string) => request(`/pins/${id}`, 'DELETE'),
  pinCategory: (id: string) => request(`/category-pins/${id}`, 'POST'),
  unpinCategory: (id: string) => request(`/category-pins/${id}`, 'DELETE'),
  addDesktopItem: (kind: DesktopItem['kind'], id: string) => request(`/desktop-shortcuts/${kind}/${id}`, 'POST'),
  removeDesktopItems: (items: DesktopItem[]) => request('/desktop-shortcuts/remove', 'POST', { items }),
  initializeDesktopLayout: (columns: number, rows: number) => request('/desktop-layout', 'POST', { columns, rows }),
  saveDesktopLayout: (items: DesktopItem[], columns: number, rows: number, previousItems: DesktopItem[], previousColumns: number, previousRows: number) => request('/desktop-layout', 'PUT', { items, columns, rows, previousItems, previousColumns, previousRows }),
  reorder: (body: object) => request('/reorder', 'POST', body),
  preferences: (preferences: Preferences) => request<Preferences>('/preferences', 'PUT', preferences),
  adminSettings: (signal?: AbortSignal) => request<AdminSettings>('/admin/settings', 'GET', undefined, signal),
  updateBranding: (value: SiteBranding) => request<AdminSettings>('/admin/settings', 'PUT', value),
  setRegistration: (registrationEnabled: boolean) =>
    request<AdminSettings>('/admin/settings', 'PUT', { registrationEnabled }),
};

export function openSite(site: Site) {
  window.open(site.url, '_blank', 'noopener,noreferrer');
}

export function favIcon(site: Site) {
  if (site.logoUrl) return site.logoUrl;
  try { return `${new URL(site.url).origin}/favicon.ico`; } catch { return ''; }
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误';
}
