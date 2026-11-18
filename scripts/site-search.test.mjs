import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/siteSearch.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { searchSites } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const sites = [
  { id: 'a', name: '文档中心', url: 'https://docs.example.com', note: '团队工具', categoryId: 'work', shared: false, editable: true },
  { id: 'b', name: '旅行计划', url: 'https://travel.example.com/UniquePath', note: '出行备忘', categoryId: 'life', shared: false, editable: true },
  { id: 'c', name: '临时收藏', url: 'https://saved.example.com', note: '团队资料', categoryId: null, shared: false, editable: true },
  { id: 'd', name: '共享文档', url: 'https://shared.example.com', note: '团队工具', categoryId: 'shared', shared: true, editable: false },
];
const ids = results => results.map(site => site.id);

test('search matches title, link or note across categories, uncategorized and shared sites', () => {
  assert.deepEqual(ids(searchSites(sites, '文档')), ['a', 'd']);
  assert.deepEqual(ids(searchSites(sites, '  UNIQUEpath  ')), ['b']);
  assert.deepEqual(ids(searchSites(sites, '团队')), ['a', 'c', 'd']);
  assert.deepEqual(ids(searchSites(sites, 'EXAMPLE.COM')), ['a', 'b', 'c', 'd']);
  assert.deepEqual(searchSites(sites, 'missing'), []);
});

test('blank queries list all visible sites and matches are not truncated to ten', () => {
  const many = Array.from({ length: 24 }, (_, i) => ({ ...sites[i % sites.length], id: String(i), name: `结果 ${i}` }));
  assert.equal(searchSites(many, '结果').length, 24);
  assert.deepEqual(ids(searchSites(many, '  ')), ids(many));
  assert.deepEqual(searchSites([], '文档'), []);
});

test('search preserves input order and visibility snapshot without matching metadata', () => {
  const original = structuredClone(sites);
  const visible = [sites[2], sites[0]];
  assert.deepEqual(ids(searchSites(visible, '团队')), ['c', 'a']);
  assert.deepEqual(searchSites(visible, '共享文档'), []);
  assert.deepEqual(searchSites(sites, 'work'), [], 'category metadata is not a title/link/note match');
  assert.deepEqual(searchSites(sites, 'personal'), []);
  assert.deepEqual(sites, original);
});
