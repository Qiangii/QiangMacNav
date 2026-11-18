import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { api, request, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
globalThis.window = new EventTarget();

test('API errors preserve session semantics and reject malformed successful responses', async t => {
  const events = [];
  t.mock.method(globalThis, 'fetch', async () => new Response('{"error":"Session expired"}', { status: 401 }));
  t.mock.method(window, 'dispatchEvent', event => { events.push(event.type); return true; });
  await assert.rejects(api.navigation(), e => e instanceof ApiError && e.status === 401);
  await assert.rejects(api.session(), e => e.status === 401);
  await assert.rejects(api.login('user', 'wrong'), e => e.status === 401);
  assert.deepEqual(events, ['harbor-session-expired']);
  fetch.mock.mockImplementation(async () => new Response('{"error":"Temporarily unavailable"}', { status: 503 }));
  await assert.rejects(api.navigation(), e => e.status === 503);
  assert.equal(events.length, 1, 'service outages must not sign the user out');
  for (const body of ['<html>proxy error</html>', 'null', '[]', '"unexpected"']) {
    fetch.mock.mockImplementation(async () => new Response(body));
    await assert.rejects(request('/test'), e => e.status === 502);
  }
  fetch.mock.mockImplementation(async () => new Response('{"id":"created"}'));
  assert.deepEqual(await api.createCategory('名称', 'personal'), { id: 'created' });
});

test('list requests forward cancellation and never convert an aborted response body to an API error', async t => {
  const controller = new AbortController();
  const pending = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => {
    assert.equal(options.signal, controller.signal);
    pending.push(url);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  const requests = [api.media(2, '中文 & name', 'image', controller.signal), api.users(3, '审核', controller.signal), api.loginLogs(false, 2, controller.signal), api.adminSettings(controller.signal)];
  controller.abort();
  const results = await Promise.allSettled(requests);
  assert.equal(pending.length, 4);
  assert.ok(pending[0].includes('q=%E4%B8%AD%E6%96%87%20%26%20name'));
  for (const result of results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.name, 'AbortError'); }
  const bodyController = new AbortController();
  fetch.mock.mockImplementation(async () => ({ status: 200, ok: true, json: async () => { bodyController.abort(); throw bodyController.signal.reason; } }));
  await assert.rejects(request('/test', 'GET', undefined, bodyController.signal), e => e.name === 'AbortError');
});
