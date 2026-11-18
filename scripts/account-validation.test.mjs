import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/accountValidation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { validUsername, validPassword, validPasswordLength, PASSWORD_HINT, USERNAME_HINT } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const cases = JSON.parse(await readFile(new URL('../testdata/account-validation.json', import.meta.url), 'utf8'));

test('account validation matches shared username and password boundary cases', () => {
  for (const [group, validate] of [['usernames', validUsername], ['passwords', validPassword], ['passwordLengths', validPasswordLength]]) {
    for (const item of cases[group]) {
      const value = item.value.repeat(item.repeat ?? 1) + (item.suffix ?? '');
      assert.equal(validate(value), item.valid, `${group}: ${value}`);
    }
  }
  assert.equal(validPassword('abc12\ud800'), false);
  assert.equal(validUsername('中文账号\ud800'), false);
  assert.ok(!PASSWORD_HINT.includes('字节') && !USERNAME_HINT.includes('字节'));
});
