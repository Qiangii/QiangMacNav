import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/ui/windowGeometry.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { resizeWindowGeometry: resize, WINDOW_RESIZE_DIRECTIONS: directions } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const initial = { position: { x: 200, y: 150 }, size: { width: 800, height: 500 } };
const viewport = { width: 1400, height: 950 }, min = { width: 640, height: 410 };
const run = (direction, x, y, size = min) => resize(initial, direction, { x, y }, viewport, size, 85);
const right = geometry => geometry.position.x + geometry.size.width;
const bottom = geometry => geometry.position.y + geometry.size.height;

test('all eight resize directions adjust only requested edges and anchor opposite edges', () => {
  for (const direction of directions) {
    const next = run(direction, 30, 20);
    assert.equal(next.position.x, direction.includes('w') ? 230 : 200, direction);
    assert.equal(next.position.y, direction.includes('n') ? 170 : 150, direction);
    assert.equal(next.size.width, direction.includes('w') ? 770 : direction.includes('e') ? 830 : 800, direction);
    assert.equal(next.size.height, direction.includes('n') ? 480 : direction.includes('s') ? 520 : 500, direction);
    if (direction.includes('w')) assert.equal(right(next), right(initial), direction);
    if (direction.includes('n')) assert.equal(bottom(next), bottom(initial), direction);
  }
  assert.deepEqual(initial, { position: { x: 200, y: 150 }, size: { width: 800, height: 500 } });
});

test('minimum size clamps dragged edges without moving the fixed edges', () => {
  for (const direction of directions) {
    const next = run(direction, direction.includes('w') ? 10000 : -10000, direction.includes('n') ? 10000 : -10000);
    assert.equal(next.size.width, /[ew]/.test(direction) ? 640 : 800, direction);
    assert.equal(next.size.height, /[ns]/.test(direction) ? 410 : 500, direction);
    if (direction.includes('w')) assert.equal(right(next), right(initial), direction);
    else assert.equal(next.position.x, initial.position.x, direction);
    if (direction.includes('n')) assert.equal(bottom(next), bottom(initial), direction);
    else assert.equal(next.position.y, initial.position.y, direction);
  }
});

test('viewport edges and Dock clearance cap growth for every direction', () => {
  for (const direction of directions) {
    const next = run(direction, direction.includes('w') ? -10000 : 10000, direction.includes('n') ? -10000 : 10000);
    if (direction.includes('w')) { assert.equal(next.position.x, 0); assert.equal(right(next), right(initial)); }
    if (direction.includes('n')) { assert.equal(next.position.y, 0); assert.equal(bottom(next), bottom(initial)); }
    if (direction.includes('e')) { assert.equal(next.position.x, 200); assert.equal(right(next), 1390); }
    if (direction.includes('s')) { assert.equal(next.position.y, 150); assert.equal(bottom(next), 865); }
    assert.ok(next.size.width >= 0 && next.size.height >= 0);
  }
});

test('moving back after an overshoot returns to the gesture origin without accumulated drift', () => {
  for (const direction of directions) {
    run(direction, 10000, 10000);
    run(direction, -10000, -10000);
    assert.deepEqual(run(direction, 0, 0), initial);
  }
});

test('small available space wins over minimum size while keeping the opposite edge anchored', () => {
  const small = { position: { x: 10, y: 10 }, size: { width: 180, height: 150 } };
  const bounds = { width: 210, height: 250 };
  const se = resize(small, 'se', { x: -1000, y: -1000 }, bounds, min, 85);
  assert.deepEqual(se, { position: { x: 10, y: 10 }, size: { width: 186, height: 155 } });
  const nw = resize(small, 'nw', { x: 1000, y: 1000 }, bounds, min, 85);
  assert.deepEqual(nw, { position: { x: 4, y: 5 }, size: { width: 186, height: 155 } });
});

test('near-fullscreen growth respects the same size caps as cache restoration', () => {
  const edge = { position: { x: 30, y: 20 }, size: { width: 1360, height: 845 } };
  const next = resize(edge, 'nw', { x: -1000, y: -1000 }, viewport, min, 85);
  assert.deepEqual(next, { position: { x: 14, y: 10 }, size: { width: 1376, height: 855 } });
  assert.equal(right(next), right(edge)); assert.equal(bottom(next), bottom(edge));
});
