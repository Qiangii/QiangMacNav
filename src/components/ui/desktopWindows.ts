export type DesktopWindowMode = 'closed' | 'visible' | 'minimized';
export type DesktopWindowsState<K extends string> = { modes: Record<K, DesktopWindowMode>; order: K[] };
type WindowRect = Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>;
export type DesktopWindowAction<K extends string> =
  | { type: 'open' | 'close' | 'minimize' | 'focus'; id: K }
  | { type: 'toggle'; id: K; bounds: ReadonlyMap<string, WindowRect> }
  | { type: 'restore'; state: DesktopWindowsState<K> };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate cached windows against the current registry; ignore removed window IDs. */
export function restoreWindows<K extends string>(defaults: Record<K, DesktopWindowMode>, saved?: unknown): DesktopWindowsState<K> {
  const ids = Object.keys(defaults) as K[];
  const raw = record(saved) ? saved : {};
  const modes = { ...defaults };
  for (const id of ids) {
    const mode = record(raw.modes) ? raw.modes[id] : undefined;
    if (mode === 'visible' || mode === 'minimized' || mode === 'closed') modes[id] = mode;
  }
  const order: K[] = [];
  for (const id of Array.isArray(raw.order) ? raw.order : []) {
    if (ids.includes(id) && modes[id as K] === 'visible' && !order.includes(id)) order.push(id);
  }
  for (const id of ids) if (modes[id] === 'visible' && !order.includes(id)) order.push(id);
  return { modes, order };
}

function coveredArea(target: WindowRect, windowsAbove: WindowRect[]): number {
  const overlaps = windowsAbove.map(rect => ({
    left: Math.max(target.left, rect.left), right: Math.min(target.right, rect.right),
    top: Math.max(target.top, rect.top), bottom: Math.min(target.bottom, rect.bottom),
  })).filter(rect => rect.right > rect.left && rect.bottom > rect.top);

  // In each vertical strip, merge the covered y intervals so overlapping windows count only once.
  const edges = [...new Set(overlaps.flatMap(rect => [rect.left, rect.right]))].sort((a, b) => a - b);
  overlaps.sort((a, b) => a.top - b.top);
  let area = 0;
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1], right = edges[i];
    let bottom = target.top;
    for (const rect of overlaps) {
      if (rect.left > left || rect.right < right || rect.bottom <= bottom) continue;
      area += (right - left) * (rect.bottom - Math.max(bottom, rect.top));
      bottom = rect.bottom;
    }
  }
  return area;
}

export function desktopWindowsReducer<K extends string>(state: DesktopWindowsState<K>, action: DesktopWindowAction<K>): DesktopWindowsState<K> {
  if (action.type === 'restore') return action.state;
  const { id } = action;
  if (!Object.prototype.hasOwnProperty.call(state.modes, id)) return state;
  const current = state.modes[id];
  if (action.type === 'focus' && (current !== 'visible' || state.order.at(-1) === id)) return state;
  if (action.type === 'minimize' && current !== 'visible') return state;
  let mode: DesktopWindowMode = 'visible';
  if (action.type === 'close') mode = 'closed';
  if (action.type === 'minimize') mode = 'minimized';
  if (action.type === 'toggle' && current === 'visible') {
    const target = action.bounds.get(id);
    if (state.order.at(-1) === id) mode = 'closed';
    else if (target) {
      const above = state.order.slice(state.order.indexOf(id) + 1);
      const covers = above.flatMap(other => action.bounds.get(other) ?? []);
      const targetArea = (target.right - target.left) * (target.bottom - target.top);
      if (coveredArea(target, covers) <= targetArea / 5) mode = 'closed';
    }
  }
  const order = state.order.filter(other => other !== id);
  if (mode === 'visible') order.push(id);
  return { modes: { ...state.modes, [id]: mode }, order };
}
