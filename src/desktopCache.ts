import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { NavigationData, User } from './types';
import type { EditorTarget } from './components/EditorDialog';
import { resolveCategorySelection } from './navigationSelection';

export const DesktopAccountContext = createContext<string | null>(null);
const prefix = 'qiangmacnav:desktop:v1:';
const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;
const keyFor = (account: string, key: string) => `${prefix}${account}:${key}`;
export function flushDesktopCache() {
  clearTimeout(timer);
  for (const [key, value] of pending) {
    try { localStorage.setItem(key, value); } catch { /* Private browsing / full storage must not break the desktop. */ }
  }
  pending.clear();
}
window.addEventListener('pagehide', flushDesktopCache);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDesktopCache(); });

export function readDesktopCache(account: string | null, key: string): unknown {
  if (!account) return null;
  try {
    const name = keyFor(account, key);
    return JSON.parse(pending.get(name) ?? localStorage.getItem(name) ?? 'null');
  } catch { return null; }
}
export function writeDesktopCache(account: string | null, key: string, value: unknown) {
  if (!account) return;
  pending.set(keyFor(account, key), JSON.stringify(value));
  clearTimeout(timer);
  timer = setTimeout(flushDesktopCache, 160);
}
export function clearDesktopCacheEntry(account: string | null, key: string) {
  if (!account) return;
  const name = keyFor(account, key);
  pending.delete(name);
  try { localStorage.removeItem(name); } catch { /* Optional persistence. */ }
}
export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const isCachedText = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096;
export function useDesktopState<T>(key: string, initial: T, valid: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>] {
  const account = useContext(DesktopAccountContext);
  const [state, setState] = useState<T>(() => {
    const saved = readDesktopCache(account, key);
    return valid(saved) ? saved : initial;
  });
  useLayoutEffect(() => { writeDesktopCache(account, key, state); }, [account, key, state]);
  return [state, setState];
}

export function restoreDesktop(account: User, data: NavigationData) {
  const raw = readDesktopCache(account.id, 'workspace');
  const saved = isRecord(raw) ? raw : {};
  const bool = (key: string, fallback: boolean) => typeof saved[key] === 'boolean' ? saved[key] as boolean : fallback;
  const selected = resolveCategorySelection(data, saved.selectedCategory);
  let editor: EditorTarget | null = null;
  const target = saved.editor;
  if (isRecord(target) && (target.kind === 'site' || target.kind === 'category')) {
    if (typeof target.id === 'string') {
      if (target.kind === 'site') {
        const site = data.sites.find(s => s.id === target.id && s.editable);
        if (site) editor = { kind: 'site', site };
      } else {
        const item = data.categories.find(c => c.id === target.id && c.editable);
        if (item) editor = { kind: 'category', category: item };
      }
    } else editor = target.kind === 'site'
      ? { kind: 'site', categoryId: data.categories.find(c => c.id === target.categoryId && c.editable)?.id }
      : { kind: 'category' };
  }
  return {
    windows: saved.windows,
    selectedCategory: selected,
    query: isCachedText(saved.query) ? saved.query : '', editor,
    spotlightOpen: !editor && bool('spotlightOpen', false),
    launchpadOpen: !editor && !bool('spotlightOpen', false) && bool('launchpadOpen', false),
  };
}

export function editorCacheKey(target: EditorTarget) {
  return `editor:${target.kind}:${target.kind === 'site' ? target.site?.id ?? target.categoryId ?? 'new' : target.category?.id ?? 'new'}`;
}
