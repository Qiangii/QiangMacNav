import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { normalizeBase, permissionOrigin, safeURL, defaultCategory, orderedCategories, identity } = await load('../src/model.ts');

test('server addresses and links cannot introduce alternate protocols or credentials', () => {
  assert.equal(normalizeBase(' https://nav.example.com/ '), 'https://nav.example.com');
  assert.equal(normalizeBase('http://localhost:8080'), 'http://localhost:8080');
  assert.equal(permissionOrigin('http://localhost:8080'), 'http://localhost/*');
  for (const value of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?token=x', 'file:///tmp/x']) assert.throws(() => normalizeBase(value));
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,x', 'https://user:pass@example.com', 'file:///tmp/x']) assert.equal(safeURL(value), '');
  assert.equal(safeURL('/favicon.ico', 'https://example.com'), 'https://example.com/favicon.ico');
  assert.equal(safeURL('', 'https://example.com'), '');
});

test('last category is scoped by server and account and must still be editable', () => {
  const categories = [{ id: 'shared', position: 0, editable: false }, { id: 'mine2', position: 2, editable: true }, { id: 'mine1', position: 1, editable: true }];
  const sorted = orderedCategories({ categories, sidebarOrder: ['mine2', 'shared'] });
  assert.deepEqual(sorted.map(c => c.id), ['mine2', 'shared', 'mine1']);
  assert.equal(defaultCategory(sorted, 'mine1'), 'mine1');
  assert.equal(defaultCategory(sorted, 'shared'), 'mine2');
  assert.equal(defaultCategory(sorted, 'deleted'), 'mine2');
  assert.equal(defaultCategory(sorted, null), null);
  assert.equal(defaultCategory([], undefined), null);
  assert.notEqual(identity({ base: 'https://one.example', user: { id: 'a' } }), identity({ base: 'https://two.example', user: { id: 'a' } }));
  assert.notEqual(identity({ base: 'https://one.example', user: { id: 'a' } }), identity({ base: 'https://one.example', user: { id: 'b' } }));
});

test('page capture resolves relative icons, bounds text and rejects unsafe icons', async () => {
  const { readPageMetadata } = await load('../src/capture.ts');
  globalThis.location = new URL('https://example.com/article?id=1#part');
  const icons = [{ rel: 'icon', getAttribute: () => 'javascript:alert(1)' }, { rel: 'shortcut icon', getAttribute: () => '../logo.png' }];
  globalThis.document = {
    title: '汉'.repeat(110), baseURI: 'https://cdn.example.com/docs/page',
    querySelectorAll: () => icons,
    querySelector: selector => selector.includes('description') ? { content: '文'.repeat(550) } : null,
  };
  try {
    const result = readPageMetadata();
    assert.equal(result.logoUrl, 'https://cdn.example.com/logo.png');
    assert.equal(result.name.length, 100); assert.equal(result.note.length, 500);
    assert.equal(result.url, 'https://example.com/article?id=1#part');
  } finally { delete globalThis.document; delete globalThis.location; }
});
