export type DesktopWindowMode = 'closed' | 'visible' | 'minimized';
export type DesktopWindowsState<K extends string> = { modes: Record<K, DesktopWindowMode>; order: K[] };
export type DesktopWindowAction<K extends string> =
  | { type: 'open' | 'close' | 'minimize' | 'focus' | 'toggle'; id: K }
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

export function desktopWindowsReducer<K extends string>(state: DesktopWindowsState<K>, action: DesktopWindowAction<K>): DesktopWindowsState<K> {
  if (action.type === 'restore') return action.state;
  const { id } = action;
  if (!Object.prototype.hasOwnProperty.call(state.modes, id)) return state;
  const current = state.modes[id];
  if (action.type === 'focus' && (current !== 'visible' || state.order.at(-1) === id)) return state;
  if (action.type === 'minimize' && current !== 'visible') return state;
  const mode = action.type === 'toggle' ? current === 'visible' ? 'minimized' : 'visible'
    : action.type === 'close' ? 'closed' : action.type === 'minimize' ? 'minimized' : 'visible';
  const order = state.order.filter(other => other !== id);
  if (mode === 'visible') order.push(id);
  return { modes: { ...state.modes, [id]: mode }, order };
}
