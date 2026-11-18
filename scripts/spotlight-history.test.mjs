import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/spotlightHistory.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { readRecentSiteIds, rememberSite, recentSites } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('visits keep the newest 20 unique sites and revisits move to the front', () => {
  let recent = [];
  for (let i = 0; i < 25; i++) recent = rememberSite(recent, `site-${i}`);
  assert.deepEqual(recent, Array.from({ length: 20 }, (_, i) => `site-${24 - i}`));
  const original = [...recent];
  const revisited = rememberSite(recent, 'site-10');
  assert.equal(revisited.length, 20);
  assert.equal(revisited[0], 'site-10');
  assert.equal(revisited.filter(id => id === 'site-10').length, 1);
  assert.deepEqual(recent, original);
});

test('history only resolves currently visible sites with current content', () => {
  const changed = { id: 'changed', name: '新名称', url: 'https://new.example.com', logoUrl: '/new.png' };
  const visible = { id: 'visible', name: '共享网站' };
  const results = recentSites([changed, visible, { id: 'never-visited' }], ['deleted', 'visible', 'no-permission', 'changed']);
  assert.deepEqual(results, [visible, changed]);
  assert.strictEqual(results[1], changed);
  assert.deepEqual(recentSites([changed], []), []);
});

test('malformed cache cannot inject site details or produce duplicate or oversized lists', () => {
  for (const invalid of [null, 'invalid JSON', {}, 123]) assert.deepEqual(readRecentSiteIds(invalid), []);
  assert.deepEqual(readRecentSiteIds(['a', null, { id: 'leaked', url: 'https://example.com' }, '', 'a', 12, 'x'.repeat(129), 'b']), ['a', 'b']);
  assert.equal(readRecentSiteIds(Array.from({ length: 100 }, (_, i) => String(i))).length, 20);
});
