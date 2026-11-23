import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { OptimisticQueue } = await load('../src/optimisticQueue.ts');
const { orderDesktop, orderCategorySites, moveNavigationSite, orderSidebar, orderDock } = await load('../src/navigationOrder.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture() {
  return { categories: [{ id: 'c', editable: true }, { id: 'd', editable: true }],
    sites: ['a', 'b', 'z'].map((id, position) => ({ id, categoryId: 'c', position, editable: true })),
    sidebarOrder: ['c', 'd'], dockItems: ['a', 'b'].map(id => ({ kind: 'site', id })),
    desktopItems: ['a', 'b'].map((id, position) => ({ kind: 'site', id, position })),
    desktopColumns: 10, desktopRows: 6, preferences: { theme: 'dark' } };
}
function harness(read) {
  const frames = [], errors = [], successes = [], refreshErrors = [];
  const queue = new OptimisticQueue(value => frames.push(value), () => {}, read);
  queue.set(fixture());
  const enqueue = (apply, save, id = '') => queue.enqueue({ apply, save,
    onSuccess: () => successes.push(id), onError: error => errors.push(error.message), onRefreshError: () => refreshErrors.push(id) });
  return { queue, enqueue, frames, errors, successes, refreshErrors };
}
const ids = data => [...data.sites].sort((a, b) => a.position - b.position).map(site => site.id);

test('slow writes keep all drops visible and serialize confirmed desktop CAS snapshots', async () => {
  let server = fixture();
  const h = harness(async () => server), first = deferred(), second = deferred(), writes = [];
  function move(position, gate) {
    h.enqueue(data => orderDesktop(data, data.desktopItems.map(item => item.id === 'a' ? { ...item, position } : item), 8, 7), async (before, after) => {
      writes.push(before.desktopItems.find(item => item.id === 'a').position);
      assert.deepEqual(before, server);
      await gate.promise; server = after;
    });
  }
  move(8, first); move(16, second);
  assert.equal(h.queue.value.desktopItems.find(item => item.id === 'a').position, 16);
  assert.deepEqual(writes, [0]);
  first.resolve(); await tick();
  assert.deepEqual(writes, [0, 8]);
  assert.equal(h.queue.value.desktopItems.find(item => item.id === 'a').position, 16, 'first response must not restore the first drop');
  second.resolve(); await tick();
  assert.equal(server.desktopItems.find(item => item.id === 'a').position, 16);
  assert.equal(h.queue.busy, false);
  assert.deepEqual(h.errors, []);
});

test('Finder and Launchpad share optimistic order and category preconditions', async () => {
  let server = fixture(); const first = deferred();
  const h = harness(async () => server);
  h.enqueue(data => moveNavigationSite(data, 'a', 'c', 2), async (_before, after) => { await first.promise; server = after; });
  const groups = [{ categoryId: 'c', previousIds: ['b', 'z', 'a'], ids: ['z', 'a', 'b'] }];
  h.enqueue(data => orderCategorySites(data, groups), async (before, after) => {
    assert.deepEqual(ids(before), groups[0].previousIds); assert.deepEqual(before, server); server = after;
  });
  assert.deepEqual(ids(h.queue.value), ['z', 'a', 'b']);
  first.resolve(); await tick();
  assert.deepEqual(ids(server), ['z', 'a', 'b']); assert.deepEqual(h.errors, []);
});

test('a drop during final refresh remains visible and saves after the read', async () => {
  let server = fixture(); const read = deferred(); let reads = 0, writes = 0;
  const h = harness(async () => ++reads === 1 ? read.promise : server);
  h.enqueue(data => orderSidebar(data, ['d', 'c']), async (_before, after) => { server = after; });
  await tick();
  h.enqueue(data => orderDock(data, ['site:b', 'site:a']), async (before, after) => { writes++; assert.deepEqual(before, server); server = after; });
  assert.equal(h.queue.value.dockItems[0].id, 'b'); assert.equal(writes, 0);
  read.resolve(server); await tick();
  assert.equal(h.queue.value.dockItems[0].id, 'b'); assert.equal(writes, 1); assert.equal(h.queue.busy, false);
});

test('failed writes cancel dependent drops, recover server state, and accept another drop during recovery', async () => {
  let server = fixture(); const write = deferred(), read = deferred(); let reads = 0, blockedWrites = 0;
  const h = harness(async () => ++reads === 1 ? read.promise : server);
  h.enqueue(data => orderSidebar(data, ['d', 'c']), async () => write.promise);
  h.enqueue(data => orderDock(data, ['site:b', 'site:a']), async () => { blockedWrites++; });
  write.reject(new Error('409 conflict')); await tick();
  assert.equal(blockedWrites, 0); assert.deepEqual(h.queue.value, server);
  h.enqueue(data => orderDock(data, ['site:b', 'site:a']), async (before, after) => { assert.deepEqual(before, server); server = after; });
  read.resolve(server); await tick();
  assert.equal(h.queue.value.dockItems[0].id, 'b'); assert.equal(h.queue.busy, false); assert.deepEqual(h.errors, ['409 conflict']);
});

test('an ambiguous failed write uses the authoritative read, not an assumed rollback', async () => {
  let server = fixture(); const h = harness(async () => server);
  h.enqueue(data => orderSidebar(data, ['d', 'c']), async (_before, after) => { server = after; throw new Error('response lost'); });
  await tick();
  assert.deepEqual(h.queue.value.sidebarOrder, ['d', 'c']); assert.deepEqual(h.errors, ['response lost']);
});

test('a later failure retains successful drops and cancels only the unconfirmed batch', async () => {
  let server = fixture(); const write = deferred(); let cancelledWrite = false;
  const h = harness(async () => server);
  h.enqueue(data => orderSidebar(data, ['d', 'c']), async (_before, after) => { server = after; });
  h.enqueue(data => orderDock(data, ['site:b', 'site:a']), async () => write.promise);
  h.enqueue(data => orderSidebar(data, ['c', 'd']), async () => { cancelledWrite = true; });
  await tick(); write.reject(new Error('offline')); await tick();
  assert.equal(cancelledWrite, false); assert.deepEqual(h.queue.value, server);
  assert.deepEqual(h.queue.value.sidebarOrder, ['d', 'c']); assert.equal(h.queue.value.dockItems[0].id, 'a');
});

test('logout cancels queued work and ignores old responses after another account starts saving', async () => {
  const old = deferred(), next = deferred(); let abandoned = false, reads = 0;
  const h = harness(async () => { reads++; return h.queue.value; });
  h.enqueue(data => orderSidebar(data, ['d', 'c']), async (_before, _after, current) => { await old.promise; assert.equal(current(), false); });
  h.enqueue(data => orderDock(data, ['site:b', 'site:a']), async () => { abandoned = true; });
  h.queue.set(null); h.queue.set(fixture());
  h.enqueue(data => orderDock(data, ['site:b', 'site:a']), async () => next.promise);
  old.resolve(); await tick();
  assert.equal(abandoned, false); assert.equal(reads, 0); assert.equal(h.queue.busy, true); assert.equal(h.queue.value.dockItems[0].id, 'b');
  next.resolve(); await tick(); assert.equal(h.queue.busy, false);
});

test('local preference updates survive in-flight writes and reads', async () => {
  const write = deferred(), read = deferred(); let server = fixture();
  const h = harness(async () => read.promise);
  h.enqueue(data => orderSidebar(data, ['d', 'c']), async (_before, after) => { await write.promise; server = after; });
  h.queue.set(data => ({ ...data, preferences: { theme: 'light' } }));
  write.resolve(); await tick();
  h.queue.set(data => ({ ...data, preferences: { theme: 'dark-again' } }));
  read.resolve(server); await tick();
  assert.equal(h.queue.value.preferences.theme, 'dark-again'); assert.deepEqual(h.queue.value.sidebarOrder, ['d', 'c']);
});

test('resetting an empty session also invalidates its in-flight initial navigation read', async () => {
  const read = deferred(); const queue = new OptimisticQueue(() => {}, () => {}, () => read.promise);
  const refresh = queue.refresh(); queue.set(null); queue.set({ account: 'new' });
  read.resolve({ account: 'old' }); await refresh;
  assert.deepEqual(queue.value, { account: 'new' });
});

test('foreground refresh started before a drop cannot overwrite it', async () => {
  const stale = deferred(), write = deferred(); let server = fixture(), reads = 0;
  const h = harness(async () => ++reads === 1 ? stale.promise : server);
  const refresh = h.queue.refresh();
  h.enqueue(data => orderSidebar(data, ['d', 'c']), async (_before, after) => { await write.promise; server = after; });
  stale.resolve(fixture()); await tick();
  assert.deepEqual(h.queue.value.sidebarOrder, ['d', 'c']);
  write.resolve(); await refresh;
  assert.deepEqual(h.queue.value.sidebarOrder, ['d', 'c']);
});

test('saved-but-refresh-failed keeps the saved order and permits the next drag', async () => {
  const h = harness(async () => { throw new Error('offline'); }); let writes = 0;
  h.enqueue(data => orderSidebar(data, ['d', 'c']), async () => { writes++; }, 'first');
  await tick(); assert.deepEqual(h.queue.value.sidebarOrder, ['d', 'c']); assert.equal(h.queue.busy, false);
  h.enqueue(data => orderDock(data, ['site:b', 'site:a']), async () => { writes++; }, 'second');
  await tick(); assert.equal(writes, 2); assert.deepEqual(h.refreshErrors, ['first', 'second']); assert.deepEqual(h.errors, []);
});

test('invalid recovery projections cannot remove additions or rearrange read-only contents', async () => {
  const data = fixture(); data.sites[1].editable = false;
  assert.throws(() => orderCategorySites(data, [{ categoryId: 'c', previousIds: ['a', 'b', 'z'], ids: ['z', 'b', 'a'] }]));
  assert.throws(() => orderDesktop(data, data.desktopItems.slice(1), 10, 6));
  assert.throws(() => orderDock(data, ['site:a', 'site:a']));
  assert.throws(() => orderSidebar(data, ['d', 'd']));
  assert.throws(() => moveNavigationSite(data, 'b', 'c', 0));
  const next = moveNavigationSite(fixture(), 'a', 'd', 0);
  assert.equal(next.sites.find(site => site.id === 'a').categoryId, 'd');
});
