import type { WALLPAPERS } from './visuals';

export interface User {
  avatarUrl: string;
  id: string;
  name: string;
  username: string;
  role: 'admin' | 'user';
}

export interface Category {
  shared: boolean;
  editable: boolean;
  iconUrl: string;
  id: string;
  name: string;
  position: number;
}

export interface Site {
  shared: boolean;
  editable: boolean;
  id: string;
  name: string;
  url: string;
  note: string;
  logoUrl: string;
  categoryId: string | null;
  position: number;
}

export interface Preferences {
  dockTools: DockTool[];
  desktopSearch: DesktopSearchConfig;
  desktopDragGrid: boolean;
  launchpadScrollMode: 'vertical' | 'horizontal';
  iconBackgroundEnabled: boolean;
  iconBackgroundColor: string;
  wallpaperUrl: string;
  wallpaperMime: string;
  navigationDragMode: 'handle' | 'longPress';
  titlebarPosition: 'left' | 'right';
  theme: 'dark' | 'light';
  wallpaper: keyof typeof WALLPAPERS;
}

export type DockTool = 'navigation' | 'search' | 'add' | 'settings';

export type SearchEngine = { id: string; name: string; url: string; iconUrl?: string };
export type DesktopSearchConfig = { enabled: boolean; engines: SearchEngine[] };

export interface DesktopItem { kind: 'site' | 'category'; id: string; position: number }

export interface NavigationData {
  sidebarOrder: string[];
  categories: Category[];
  sites: Site[];
  dockItems: { kind: 'site' | 'category'; id: string }[];
  desktopItems: DesktopItem[];
  desktopColumns: number;
  desktopRows: number;
  preferences: Preferences;
}

export interface SiteBranding {
  siteTitle: string;
  siteLogoUrl: string;
}

export interface AdminSettings extends SiteBranding {
  registrationEnabled: boolean;
}

export interface SystemVersion { version: string; commit: string; builtAt: string }
export interface SystemRelease { version: string; digest: string; protocol: number; notes: string; url: string; publishedAt: string }
export interface UpdateJob { id: string; version: string; stage: 'queued' | 'pulling' | 'backing_up' | 'replacing' | 'starting' | 'verifying' | 'rolling_back' | 'succeeded' | 'failed' | 'rolled_back' | 'interrupted'; message: string; startedAt: string; updatedAt: string; backupReady: boolean }
export interface SystemUpdateStatus {
  current: SystemVersion;
  configured: boolean;
  configurationMessage: string;
  latest: SystemRelease | null;
  checkedAt: string | null;
  updateAvailable: boolean;
  updater: { available: boolean; uploadArch?: string; message: string; job: UpdateJob | null };
}

export interface Bootstrap extends SiteBranding {
  hasUsers: boolean;
  registrationEnabled: boolean;
  setupRequired: boolean;
  setupTokenRequired: boolean;
}

export interface ManagedUser {
  id: string; name: string; username: string; role: 'admin' | 'user'; disabled: boolean;
  createdAt: string; lastLogin: string | null;
}
export interface LoginLog {
  source: 'web' | 'extension';
  id: number; username: string; success: boolean; ip: string; userAgent: string; createdAt: string;
}

export type MediaKind = 'image' | 'wallpaper' | 'avatar';

export interface MediaImage {
  id: string; name: string; url: string; width: number; height: number; size: number; mime: string;
}
export interface CatalogIcon {
  id: string; name: string; url: string; category: string;
}
export interface IconCatalog {
  categories: { id: string; name: string }[];
  items: CatalogIcon[];
}
export type SessionActivity = { expiresAt: number; checkAfterSeconds: number };
