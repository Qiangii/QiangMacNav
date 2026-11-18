import type { DesktopSearchConfig, SearchEngine } from '../types';

export const DEFAULT_DESKTOP_SEARCH: DesktopSearchConfig = {
  enabled: true,
  engines: [
    { id: 'google', name: '谷歌', url: 'https://www.google.com/search?q={query}', iconUrl: '/assets/icons/google-icon-new.png' },
    { id: 'twitter', name: '推特', url: 'https://x.com/search?q={query}', iconUrl: '/assets/icons/twitter.svg' },
    { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd={query}', iconUrl: '/assets/icons/baidu.svg' },
    { id: 'bing', name: '必应', url: 'https://www.bing.com/search?q={query}', iconUrl: '/assets/icons/bing.svg' },
  ],
};

export function searchEngineError(engine: SearchEngine) {
  if (!engine.name.trim() || [...engine.name.trim()].length > 32) return '搜索名称需要 1–32 个字符';
  try {
    const url = new URL(engine.url.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[{}]/.test(url.host) || engine.url.length > 2048 || !engine.url.includes('{query}')) throw new Error();
  } catch { return '请输入包含 {query} 的 HTTP 或 HTTPS 搜索链接'; }
  return '';
}

export function searchURL(engine: SearchEngine, query: string) {
  if (!query.trim() || searchEngineError(engine)) return '';
  return engine.url.trim().replaceAll('{query}', encodeURIComponent(query.trim()));
}

export const SEARCH_HEIGHT = 52;
export const SEARCH_DEFAULT_WIDTH = 560;
export const SEARCH_MIN_WIDTH = 280;
export type SearchGeometry = { x: number; y: number; width: number };
export type SearchBounds = { width: number; height: number };
export type SavedSearchGeometry = SearchGeometry & { bounds: SearchBounds };
const dimension = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000;
export const isSearchGeometry = (value: unknown): value is SavedSearchGeometry | null => value === null || typeof value === 'object' && value !== null &&
  'x' in value && 'y' in value && 'width' in value && [value.x, value.y].every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1_000_000) && dimension(value.width) &&
  ('bounds' in value && typeof value.bounds === 'object' && value.bounds !== null && 'width' in value.bounds && 'height' in value.bounds && dimension(value.bounds.width) && dimension(value.bounds.height));

export function saveDesktopSearch(geometry: SearchGeometry, bounds: SearchBounds): SavedSearchGeometry {
  return { ...geometry, bounds: { ...bounds } };
}

// Scale width with the desktop and keep the same fraction of the free travel on
// each axis. Center/right/bottom anchors survive minimum-width clamping as well.
export function desktopSearchLayout(bounds: SearchBounds, saved: SavedSearchGeometry | null): SearchGeometry {
  const reference = saved?.bounds;
  const desiredWidth = saved ? saved.width * bounds.width / saved.bounds.width : SEARCH_DEFAULT_WIDTH * Math.min(1, bounds.width / 1248);
  const width = Math.min(Math.max(0, bounds.width), Math.max(SEARCH_MIN_WIDTH, desiredWidth));
  const freeX = Math.max(0, bounds.width - width), freeY = Math.max(0, bounds.height - SEARCH_HEIGHT);
  const x = Math.max(0, Math.min(freeX, reference ? (reference.width > saved.width ? saved.x / (reference.width - saved.width) : .5) * freeX : freeX / 2));
  const y = Math.max(0, Math.min(freeY, reference ? (reference.height > SEARCH_HEIGHT ? saved.y / (reference.height - SEARCH_HEIGHT) : 0) * freeY : freeY * .2));
  return { x, y, width };
}

export function resizeDesktopSearch(origin: SearchGeometry, deltaX: number, bounds: SearchBounds): SearchGeometry {
  const available = Math.max(0, bounds.width - origin.x);
  return { ...origin, width: Math.min(available, Math.max(Math.min(SEARCH_MIN_WIDTH, available), origin.width + deltaX)) };
}

// Desktop icons still use cells. Reserve every cell intersecting the free rectangle,
// including partially covered cells, without snapping the search widget itself.
// On phones, reserve the entire band above its bottom so icons and drops stay below it.
export function searchOccupiedCells(box: SearchGeometry, grid: { columns: number; cellWidth: number }, cellHeight: number, belowSearchOnly = false) {
  const cells = new Set<number>();
  if (box.width <= 0 || grid.cellWidth <= 0 || cellHeight <= 0) return cells;
  const firstColumn = belowSearchOnly ? 0 : Math.max(0, Math.floor(box.x / grid.cellWidth));
  const lastColumn = belowSearchOnly ? grid.columns - 1 : Math.min(grid.columns - 1, Math.ceil((box.x + box.width) / grid.cellWidth) - 1);
  const firstRow = belowSearchOnly ? 0 : Math.max(0, Math.floor(box.y / cellHeight));
  const lastRow = Math.min(Math.floor(4095 / grid.columns), Math.ceil((box.y + SEARCH_HEIGHT) / cellHeight) - 1);
  for (let row = firstRow; row <= lastRow; row++) for (let column = firstColumn; column <= lastColumn; column++) {
    const cell = row * grid.columns + column;
    if (cell < 4096) cells.add(cell);
  }
  return cells;
}
