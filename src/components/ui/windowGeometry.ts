export type WindowGeometry = { position: { x: number; y: number }; size: { width: number; height: number } };
export const WINDOW_RESIZE_DIRECTIONS = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as const;
export type WindowResizeDirection = typeof WINDOW_RESIZE_DIRECTIONS[number];

// Resize each requested edge while anchoring its opposite edge. Clamp the edge
// itself so reaching a minimum or the viewport never makes the window drift.
export function resizeWindowGeometry(
  initial: WindowGeometry, direction: WindowResizeDirection, delta: { x: number; y: number },
  viewport: { width: number; height: number }, minSize: { width: number; height: number }, bottomInset: number,
): WindowGeometry {
  let { x, y } = initial.position;
  let { width, height } = initial.size;
  const right = x + width, bottom = y + height;
  // Match useMacWindow's restore/viewport clamp, including desktop margins.
  const maxWidth = Math.max(0, viewport.width - 24);
  const maxHeight = Math.max(0, viewport.height - bottomInset - 10);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  if (direction.includes('w')) {
    const left = Math.max(0, right - maxWidth);
    x = clamp(x + delta.x, left, Math.max(left, right - minSize.width));
    width = right - x;
  } else if (direction.includes('e')) {
    const available = Math.max(0, Math.min(maxWidth, viewport.width - x - 10));
    width = clamp(width + delta.x, Math.min(minSize.width, available), available);
  }
  if (direction.includes('n')) {
    const top = Math.max(0, bottom - maxHeight);
    y = clamp(y + delta.y, top, Math.max(top, bottom - minSize.height));
    height = bottom - y;
  } else if (direction.includes('s')) {
    const available = Math.max(0, Math.min(maxHeight, viewport.height - y - bottomInset));
    height = clamp(height + delta.y, Math.min(minSize.height, available), available);
  }
  return { position: { x, y }, size: { width, height } };
}
