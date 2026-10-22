'use strict';
/** Executes the actual DB-suite bootstrap in a sandbox. No real DB connection. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
if (!process.env.AHP_SOURCE_ROOT) throw new Error('Set AHP_SOURCE_ROOT.');
const root = fs.realpathSync(process.env.AHP_SOURCE_ROOT);
let ts;
try { ts = createRequire(path.join(root, 'package.json'))('typescript'); }
catch { ts = require('typescript'); }
const file = path.join(root, 'services/followup/src/tests/followup.test.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true, fileName: file,
});
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const source = compiled.outputText;
const goodEnv = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost:55439/ahealth_test' };
const goodIdentity = { database_name: 'ahealth_test', server_address: '127.0.0.1', server_port: 55439 };
function bootstrap(env, identity = goodIdentity, probeError = false) {
  const beforeHooks = [], afterHooks = [], suites = [];
  let queries = 0;
  const prisma = { $queryRaw: async () => {
    queries++;
    if (probeError) throw new Error('synthetic failure with private connection details');
    return identity === null ? [] : [identity];
  } };
  const testStub = {
    before: hook => beforeHooks.push(hook), after: hook => afterHooks.push(hook),
    describe: name => suites.push(name), it: () => { throw new Error('DB test body must not execute'); },
  };
  const requireStub = specifier => {
    if (specifier === 'node:test') return testStub;
    if (specifier === 'node:assert/strict' || specifier === 'node:crypto') return require(specifier);
    if (specifier === '@a-health/database') return { prisma };
    if (specifier.startsWith('../')) return {};
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  const mod = { exports: {} };
  const context = { process: { env: { ...env } }, URL, require: requireStub, module: mod, exports: mod.exports };
  let error = null;
  try { vm.runInNewContext(source, context, { filename: file }); }
  catch (e) { error = e; }
  return { error, beforeHooks, afterHooks, suites, queryCount: () => queries };
}
for (const [name, overrides] of [
  ['missing NODE_ENV', { NODE_ENV: undefined }],
  ['development mode', { NODE_ENV: 'development' }],
  ['production mode', { NODE_ENV: 'production' }],
  ['missing database URL', { DATABASE_URL: undefined }],
  ['malformed database URL', { DATABASE_URL: 'not-a-url' }],
  ['non-PostgreSQL URL', { DATABASE_URL: 'https://localhost:55439/ahealth_test' }],
  ['development database', { DATABASE_URL: 'postgresql://localhost:55439/ahealth_dev' }],
  ['remote server', { DATABASE_URL: 'postgresql://not-local.invalid:55439/ahealth_test' }],
  ['unspecified/default port', { DATABASE_URL: 'postgresql://localhost/ahealth_test' }],
  ['protected port 5432', { DATABASE_URL: 'postgresql://localhost:5432/ahealth_test' }],
]) {
  test(`DB-suite guard rejects ${name} before any probe or test body`, () => {
    const run = bootstrap({ ...goodEnv, ...overrides });
    assert.ok(run.error, 'invalid configuration must fail closed');
    assert.equal(run.queryCount(), 0);
    assert.equal(run.suites.length, 0);
  });
}
for (const [name, identity] of [
  ['different database', { ...goodIdentity, database_name: 'ahealth_dev' }],
  ['different port', { ...goodIdentity, server_port: 5432 }],
  ['non-loopback server', { ...goodIdentity, server_address: '192.0.2.50' }],
  ['missing server identity', null],
]) {
  test(`read-only identity gate rejects ${name}`, async () => {
    const run = bootstrap(goodEnv, identity);
    assert.equal(run.error, null); assert.equal(run.beforeHooks.length, 1);
    await assert.rejects(run.beforeHooks[0], /not the approved isolated ahealth_test/);
    assert.equal(run.queryCount(), 1);
  });
}
test('connection-probe failure is sanitized', async () => {
  const run = bootstrap(goodEnv, goodIdentity, true);
  await assert.rejects(run.beforeHooks[0], e => {
    assert.equal(e.message, 'Could not verify Follow-up test database identity; no tests were run.');
    assert.ok(!e.message.includes('private connection'));
    return true;
  });
});
test('matching local ahealth_test identity passes the guard (not DB acceptance)', async () => {
  const run = bootstrap(goodEnv);
  assert.equal(run.error, null); assert.equal(run.beforeHooks.length, 1);
  await run.beforeHooks[0](); assert.equal(run.queryCount(), 1);
});
test('IPv6 loopback is accepted only with matching database and explicit test port', async () => {
  const run = bootstrap({ ...goodEnv, DATABASE_URL: 'postgresql://[::1]:55439/ahealth_test' }, { ...goodIdentity, server_address: '::1' });
  assert.equal(run.error, null); await run.beforeHooks[0]();
});
