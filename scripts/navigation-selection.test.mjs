import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/navigationSelection.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { resolveCategorySelection, navigationView } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const data = {
  categories: [{ id: 'first', position: 0 }, { id: 'second', position: 1 }, { id: 'shared', position: 2, shared: true, editable: false }],
  sidebarOrder: ['removed', 'second', 'first', 'shared'],
  sites: [{ id: 'one', categoryId: 'first', position: 0 }, { id: 'two', categoryId: 'second', position: 0 }, { id: 'orphan', categoryId: null, position: 0 }],
};

test('missing or invalid selection opens the first visible sidebar category and only its sites', () => {
  for (const selection of [undefined, '', 'all', 'deleted']) {
    assert.equal(resolveCategorySelection(data, selection), 'second');
    assert.deepEqual(navigationView(data, data, selection).allSites.map(site => site.id), ['two']);
  }
  assert.equal(resolveCategorySelection({ ...data, sidebarOrder: [] }, ''), 'first');
  assert.equal(resolveCategorySelection(data, 'first'), 'first');
  assert.equal(resolveCategorySelection(data, 'shared'), 'shared');
  assert.deepEqual(navigationView(data, data, 'shared').allSites, []);
});

test('creating the first category and removing the selected category resolve without an all-sites view', () => {
  const empty = { categories: [], sites: [], sidebarOrder: [] };
  assert.equal(resolveCategorySelection(empty, ''), '');
  assert.equal(resolveCategorySelection({ ...empty, categories: [data.categories[0]] }, ''), 'first');
  const removed = { ...data, categories: data.categories.filter(category => category.id !== 'second'), sites: data.sites.filter(site => site.categoryId !== 'second') };
  assert.equal(resolveCategorySelection(removed, 'second'), 'first');
  assert.deepEqual(navigationView(removed, removed, 'second').allSites.map(site => site.id), ['one']);
  assert.equal(resolveCategorySelection({ ...data, categories: data.categories.slice(0, 2) }, 'shared'), 'second');
});

test('uncategorized remains explicitly selectable and is the fallback only when no categories exist', () => {
  assert.equal(resolveCategorySelection(data, 'uncategorized'), 'uncategorized');
  assert.deepEqual(navigationView(data, data, 'uncategorized').allSites.map(site => site.id), ['orphan']);
  const orphanOnly = { ...data, categories: [], sites: data.sites.filter(site => site.categoryId === null) };
  assert.equal(resolveCategorySelection(orphanOnly, ''), 'uncategorized');
  assert.equal(resolveCategorySelection({ ...data, sites: [] }, 'uncategorized'), 'second');
  assert.deepEqual(navigationView({ ...orphanOnly, sites: [] }, { ...orphanOnly, sites: [] }, '').allSites, []);
});
