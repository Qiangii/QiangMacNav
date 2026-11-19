import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/ui/desktopWindows.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { restoreWindows, desktopWindowsReducer: reduce } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const defaults = { finder: 'visible', settings: 'closed', notes: 'closed' };
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });
const separate = new Map(Object.keys(defaults).map((id, i) => [id, rect(i * 100, 0, 100, 100)]));

test('Dock toggles only its target for every combination of three window states', () => {
  for (const finder of ['closed', 'minimized', 'visible']) {
    for (const settings of ['closed', 'minimized', 'visible']) {
      for (const notes of ['closed', 'minimized', 'visible']) {
        const modes = { finder, settings, notes };
        for (const id of Object.keys(modes)) {
          const state = restoreWindows(defaults, { modes });
          const next = reduce(state, { type: 'toggle', id, bounds: separate });
          for (const other of Object.keys(modes)) {
            assert.equal(next.modes[other], other === id ? modes[id] === 'visible' ? 'closed' : 'visible' : modes[other]);
          }
          assert.equal(next.order.at(-1) ?? null, modes[id] === 'visible' ? state.order.filter(other => other !== id).at(-1) ?? null : id);
          assert.deepEqual(state.modes, modes, 'input snapshot must remain immutable');
        }
      }
    }
  }
});

test('Dock closes up to and including 20% coverage, and raises above 20% without closing other windows', () => {
  const state = reduce(restoreWindows(defaults), { type: 'open', id: 'settings' });
  for (const width of [0, 39.99, 40, 40.01, 200]) {
    const bounds = new Map([['finder', rect(25, 30, 200, 100)], ['settings', rect(225 - width, 0, 300, 200)]]);
    const clicked = reduce(state, { type: 'toggle', id: 'finder', bounds });
    assert.equal(clicked.modes.settings, 'visible');
    assert.equal(clicked.modes.finder, width > 40 ? 'visible' : 'closed');
    if (width > 40) {
      assert.deepEqual(clicked.order, ['settings', 'finder']);
      assert.equal(reduce(clicked, { type: 'toggle', id: 'finder', bounds }).modes.finder, 'closed');
    }
  }
});

test('coverage counts the union of windows above the target and ignores windows below or minimized', () => {
  const modes = { finder: 'visible', settings: 'visible', notes: 'visible' };
  const state = restoreWindows(defaults, { modes, order: ['finder', 'settings', 'notes'] });
  const bounds = new Map([['finder', rect(0, 0, 100, 100)], ['settings', rect(0, 0, 50, 30)], ['notes', rect(20, 0, 50, 30)]]);
  const toggle = { type: 'toggle', id: 'finder', bounds };
  assert.deepEqual(reduce(state, toggle).order, ['settings', 'notes', 'finder']); // 21% combined
  assert.equal(reduce(reduce(state, { type: 'minimize', id: 'notes' }), toggle).modes.finder, 'closed');
  assert.equal(reduce(restoreWindows(defaults, { modes, order: ['notes', 'finder', 'settings'] }), toggle).modes.finder, 'closed');
  bounds.set('notes', rect(0, 10, 50, 30)); // 20% combined, including 10% shared by both covers
  assert.equal(reduce(state, toggle).modes.finder, 'closed');
});

test('open/focus/close/minimize restore the most recent visible window without changing other windows', () => {
  let state = restoreWindows(defaults);
  for (const id of ['settings', 'notes', 'finder']) state = reduce(state, { type: 'open', id });
  assert.deepEqual(state.order, ['settings', 'notes', 'finder']);
  state = reduce(state, { type: 'minimize', id: 'finder' });
  assert.equal(state.order.at(-1), 'notes');
  state = reduce(state, { type: 'focus', id: 'settings' });
  assert.deepEqual(state.order, ['notes', 'settings']);
  state = reduce(state, { type: 'close', id: 'settings' });
  assert.equal(state.order.at(-1), 'notes');
  assert.equal(state.modes.finder, 'minimized');
  assert.equal(reduce(state, { type: 'focus', id: 'finder' }), state, 'hidden focus events cannot reopen windows');
  state = reduce(state, { type: 'close', id: 'notes' });
  assert.deepEqual(state.order, []);
  state = reduce(state, { type: 'toggle', id: 'finder', bounds: separate });
  assert.deepEqual(state.order, ['finder']);
});

test('rapid toggles are sequential, and explicit open is idempotent', () => {
  let state = restoreWindows(defaults);
  for (let i = 0; i < 4; i++) state = reduce(state, { type: 'toggle', id: 'settings', bounds: separate });
  assert.equal(state.modes.settings, 'closed');
  assert.equal(state.modes.finder, 'visible');
  state = reduce(state, { type: 'open', id: 'settings' });
  assert.deepEqual(reduce(state, { type: 'open', id: 'settings' }), state);
});

test('restore preserves independent windows and validates malformed or obsolete cache entries', () => {
  const state = { modes: { finder: 'minimized', settings: 'visible', notes: 'visible' }, order: ['notes', 'settings'] };
  assert.deepEqual(restoreWindows(defaults, JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(restoreWindows(defaults, { modes: { finder: 'oops', settings: 'visible', removed: 'visible' }, order: ['removed', 'settings', 'settings', '__proto__'] }), {
    modes: { finder: 'visible', settings: 'visible', notes: 'closed' }, order: ['settings', 'finder'],
  });
  assert.deepEqual(restoreWindows(defaults, null), { modes: defaults, order: ['finder'] });
  assert.deepEqual(restoreWindows(defaults, { modes: [], order: {} }), { modes: defaults, order: ['finder'] });
  assert.equal(reduce(state, { type: 'toggle', id: 'removed', bounds: separate }), state);
});
