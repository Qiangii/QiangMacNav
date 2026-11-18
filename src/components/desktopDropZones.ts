import type { DesktopItem } from '../types';
import type { desktopGrid, desktopGroupOffset } from './desktopGrid';

type Rect = { left: number; top: number; width: number; height: number };
export type DesktopPointer = { x: number; y: number };
type Viewport = Rect & { scrollLeft: number; scrollTop: number };

function intersection(a: Rect, b: Rect): Rect {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  return { left, top, width: Math.max(0, Math.min(a.left + a.width, b.left + b.width) - left), height: Math.max(0, Math.min(a.top + a.height, b.top + b.height) - top) };
}

/** Track live Dock/window geometry; skip retained windows that are minimized or closing. */
export function desktopDropRegions(): Rect[] {
  const regions: Rect[] = [];
  for (const node of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], #desktop-dock, #desktop-dock .dock-icon')) {
    if (node.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') continue;
    const bounds = node.getBoundingClientRect();
    let rect: Rect = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    // Overflowed Dock items must not block the empty desktop beside the Dock.
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
        const left = Math.max(rect.left, bounds.left);
        rect = { ...rect, left, width: Math.max(0, Math.min(rect.left + rect.width, bounds.right) - left) };
      }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
        const top = Math.max(rect.top, bounds.top);
        rect = { ...rect, top, height: Math.max(0, Math.min(rect.top + rect.height, bounds.bottom) - top) };
      }
    }
    if (rect.width > 0 && rect.height > 0) regions.push(rect);
  }
  return regions;
}

/** Pointer checks cover the Dock even when the icon preview is clamped above it. */
export function desktopDropBlocked(items: DesktopItem[], keys: Set<string>, offset: ReturnType<typeof desktopGroupOffset>, grid: ReturnType<typeof desktopGrid>, cellHeight: number, viewport: Viewport, regions: Rect[], pointer?: DesktopPointer): boolean {
  if (pointer && regions.some(rect => pointer.x >= rect.left && pointer.x < rect.left + rect.width && pointer.y >= rect.top && pointer.y < rect.top + rect.height)) return true;
  const overlaps = (rect: Rect) => {
    // Icons outside the scroll viewport are clipped and cannot hit a visible window.
    const visible = intersection(rect, viewport);
    return visible.width > 0 && visible.height > 0 && regions.some(region => {
      const overlap = intersection(visible, region);
      return overlap.width > 0 && overlap.height > 0;
    });
  };
  return items.some(item => {
    if (!keys.has(`${item.kind}:${item.id}`)) return false;
    const left = viewport.left - viewport.scrollLeft + item.position % grid.columns * grid.cellWidth;
    const top = viewport.top - viewport.scrollTop + Math.floor(item.position / grid.columns) * cellHeight;
    // Both the moving preview and the snapped destination must be clear.
    return overlaps({ left: left + offset.x, top: top + offset.y, width: grid.cellWidth, height: cellHeight })
      || overlaps({ left: left + offset.column * grid.cellWidth, top: top + offset.row * cellHeight, width: grid.cellWidth, height: cellHeight });
  });
}
