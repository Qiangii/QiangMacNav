import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/ui/desktopWindows.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { restoreWindows, desktopWindowsReducer: reduce } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const defaults = { finder: 'visible', settings: 'closed', notes: 'closed' };

test('Dock toggles only its target for every combination of three window states', () => {
  for (const finder of ['closed', 'minimized', 'visible']) {
    for (const settings of ['closed', 'minimized', 'visible']) {
      for (const notes of ['closed', 'minimized', 'visible']) {
        const modes = { finder, settings, notes };
        for (const id of Object.keys(modes)) {
          const state = restoreWindows(defaults, { modes });
          const next = reduce(state, { type: 'toggle', id });
          for (const other of Object.keys(modes)) {
            assert.equal(next.modes[other], other === id ? modes[id] === 'visible' ? 'minimized' : 'visible' : modes[other]);
          }
          assert.equal(next.order.at(-1) ?? null, modes[id] === 'visible' ? state.order.filter(other => other !== id).at(-1) ?? null : id);
          assert.deepEqual(state.modes, modes, 'input snapshot must remain immutable');
        }
      }
    }
  }
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
  state = reduce(state, { type: 'toggle', id: 'finder' });
  assert.deepEqual(state.order, ['finder']);
});

test('rapid toggles are sequential, and explicit open is idempotent', () => {
  let state = restoreWindows(defaults);
  for (let i = 0; i < 4; i++) state = reduce(state, { type: 'toggle', id: 'settings' });
  assert.equal(state.modes.settings, 'minimized');
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
  assert.equal(reduce(state, { type: 'toggle', id: 'removed' }), state);
});
