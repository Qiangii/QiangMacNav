import type { DesktopItem } from '../types';

export const DESKTOP_CELL_HEIGHT = 100;
export const desktopKey = (item: Pick<DesktopItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`;
export const desktopColumns = (width: number) => Math.max(1, Math.min(64, Math.floor(width / 96)));
export const desktopVisibleRows = (height: number) => Math.max(1, Math.min(4096, Math.floor(height / DESKTOP_CELL_HEIGHT)));

// Keep row-major storage, but spill down each visible column before continuing at
// the top of the next. Only a deliberate move replaces the saved row/column anchors.
export function projectDesktopItems(items: DesktopItem[], savedColumns: number, columns: number, visibleRows: number, reserved: Set<number> = new Set(), savedRows = 0): DesktopItem[] {
  savedColumns ||= columns;
  const rows = Math.max(1, Math.min(Math.floor(4096 / columns), visibleRows));
  // At the saved viewport, intentional scrollable overflow is already arranged.
  // Re-inserting it on every render/save would rotate a full desktop indefinitely.
  const originalSize = savedColumns === columns && savedRows === visibleRows;
  const capacity = columns * rows;
  const occupied = new Map<number, DesktopItem>();
  const positions = new Map<string, number>();
  const pending: DesktopItem[] = [];
  const ordered = [...items].sort((a, b) => a.position % savedColumns - b.position % savedColumns || a.position - b.position);
  for (const item of ordered) {
    const col = item.position % savedColumns, row = Math.floor(item.position / savedColumns);
    const position = row * columns + col;
    if (col < columns && (row < rows || originalSize) && position < 4096 && !reserved.has(position)) occupied.set(position, item);
    else pending.push(item);
  }
  if (pending.length) {
    const order: number[] = [];
    for (let band = 0; band < 4096; band += capacity) {
      for (let col = 0; col < columns; col++) for (let row = 0; row < rows; row++) {
        const position = band + row * columns + col;
        if (position < 4096) order.push(position);
      }
    }
    // Earlier overflow items keep their relative order when targets coincide.
    const inserted = new Set<string>();
    for (const item of pending) {
      const col = Math.min(item.position % savedColumns, columns - 1), row = Math.floor(item.position / savedColumns);
      const start = (col * rows + row) % capacity;
      let carry: DesktopItem | undefined = item;
      // Wrap inside the visible desktop before using scrollable overflow bands.
      // Inserting carries only consecutive occupants; the first gap ends the chain.
      for (let step = 0; carry && step < order.length; step++) {
        const position = order[step < capacity ? (start + step) % capacity : step];
        const occupant = occupied.get(position);
        if (reserved.has(position) || occupant && inserted.has(desktopKey(occupant))) continue;
        occupied.set(position, carry);
        carry = occupant;
      }
      inserted.add(desktopKey(item));
    }
  }
  for (const [position, item] of occupied) positions.set(desktopKey(item), position);
  return items.map(item => positions.get(desktopKey(item)) === item.position ? item : { ...item, position: positions.get(desktopKey(item))! });
}

export function desktopGrid(width: number, height: number, items: DesktopItem[]) {
  const columns = desktopColumns(width);
  const last = Math.max(0, ...items.map(item => item.position));
  return { columns, cellWidth: width / columns, rows: Math.max(desktopVisibleRows(height), Math.ceil((last + 1) / columns)) };
}

export function desktopDropPosition(position: number, delta: { x: number; y: number }, grid: ReturnType<typeof desktopGrid>) {
  const col = Math.min(grid.columns - 1, Math.max(0, Math.round(position % grid.columns + delta.x / grid.cellWidth)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.round(Math.floor(position / grid.columns) + delta.y / DESKTOP_CELL_HEIGHT)));
  return Math.min(4095, row * grid.columns + col);
}

export function moveDesktopItem(items: DesktopItem[], key: string, position: number) {
  const moving = items.find(item => desktopKey(item) === key);
  if (!moving || moving.position === position) return items;
  return items.map(item => desktopKey(item) === key ? { ...item, position } : item.position === position ? { ...item, position: moving.position } : item);
}

export function desktopGroupOffset(items: DesktopItem[], keys: Set<string>, delta: { x: number; y: number }, grid: ReturnType<typeof desktopGrid>, reserved: Set<number> = new Set()) {
  const group = items.filter(item => keys.has(desktopKey(item)));
  if (!group.length) return { x: 0, y: 0, column: 0, row: 0, blocked: false };
  const columns = group.map(item => item.position % grid.columns);
  const rows = group.map(item => Math.floor(item.position / grid.columns));
  const minRow = Math.min(...rows), lastRow = Math.max(...rows), minCol = Math.min(...columns), lastCol = Math.max(...columns);
  const lastPosition = Math.max(...group.map(item => item.position));
  const maxColumn = Math.min(grid.columns - 1 - lastCol, 4095 - lastPosition + minRow * grid.columns);
  const x = Math.max(-minCol * grid.cellWidth, Math.min(maxColumn * grid.cellWidth, delta.x));
  const column = Math.round(x / grid.cellWidth);
  const maxRow = Math.min(grid.rows - 1 - lastRow, Math.floor((4095 - lastPosition - column) / grid.columns));
  const y = Math.max(-minRow * DESKTOP_CELL_HEIGHT, Math.min(maxRow * DESKTOP_CELL_HEIGHT, delta.y));
  const row = Math.round(y / DESKTOP_CELL_HEIGHT);
  const blocked = group.some(item => reserved.has(item.position + row * grid.columns + column));
  // Keep the preview under the pointer. A reserved target cancels the drop
  // instead of snapping the group to a different, unexpected destination.
  return { x, y, column, row, blocked };
}

export function moveDesktopGroup(items: DesktopItem[], keys: Set<string>, offset: { column: number; row: number; blocked?: boolean }, columns: number) {
  const shift = offset.row * columns + offset.column;
  if (!shift || offset.blocked) return items;
  const group = items.filter(item => keys.has(desktopKey(item)));
  const targets = new Set(group.map(item => item.position + shift));
  const vacated = group.map(item => item.position).filter(position => !targets.has(position)).sort((a, b) => a - b);
  // Occupants move into the group's vacated cells; unrelated icons stay put.
  const displaced = items.filter(item => !keys.has(desktopKey(item)) && targets.has(item.position)).sort((a, b) => a.position - b.position);
  const replacements = new Map(displaced.map((item, index) => [desktopKey(item), vacated[index]]));
  return items.map(item => keys.has(desktopKey(item)) ? { ...item, position: item.position + shift } : replacements.has(desktopKey(item)) ? { ...item, position: replacements.get(desktopKey(item))! } : item);
}
