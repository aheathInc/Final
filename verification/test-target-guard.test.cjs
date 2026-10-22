'use strict';
/** Offline tests of the actual test-only guard. No PostgreSQL/dependency imports. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const root = process.env.AHP_SOURCE_ROOT;
if (!root) throw new Error('Set AHP_SOURCE_ROOT to the candidate checkout.');
let ts;
try { ts = createRequire(path.join(path.resolve(root), 'package.json'))('typescript'); }
catch { ts = require('typescript'); }
const filename = path.join(root, 'services/consultation/src/tests/safety-test-target.ts');
const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true, fileName: filename,
});
assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
new vm.Script(`(function(require,module,exports){${result.outputText}\n})`, { filename }).runInThisContext()(
  () => { throw new Error('Guard must not import app/dependency code.'); }, mod, mod.exports,
);
const { parseSafetyTestTarget: parse, assertSafetyDatabaseIdentity: identity, SAFETY_DB_ACK: ACK } = mod.exports;
const generatedPassword = randomBytes(24).toString('hex');
const valid = () => ({ NODE_ENV: 'test', AHP_SAFETY_TEST_DB_ACK: ACK,
  DATABASE_URL: `postgresql://synthetic:${generatedPassword}@127.0.0.1:55439/ahealth_test` });
const row = () => ({ database_name: 'ahealth_test', server_address: '127.0.0.1', server_port: 55439,
  database_owner: 'synthetic', login_role: 'synthetic', in_recovery: false });

for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
  test(`allows explicit test target on ${host}`, () => {
    const env = valid(); env.DATABASE_URL = env.DATABASE_URL.replace('127.0.0.1', host);
    assert.equal(parse(env).port, 55439); assert.equal(Object.hasOwn(parse(env), 'url'), false);
  });
}
for (const mode of [undefined, 'development', 'production', 'staging']) {
  test(`rejects NODE_ENV ${String(mode)}`, () => assert.throws(() => parse({ ...valid(), NODE_ENV: mode })));
}
for (const ack of [undefined, 'true', 'ahealth_test']) {
  test(`rejects absent/incorrect disposable acknowledgement: ${String(ack)}`, () => assert.throws(() => parse({ ...valid(), AHP_SAFETY_TEST_DB_ACK: ack })));
}
for (const [label, edit] of [
  ['missing URL', () => undefined], ['malformed URL', () => 'not-a-url'],
  ['remote host', s => s.replace('127.0.0.1', 'example.invalid')],
  ['port 5432', s => s.replace('55439', '5432')], ['implicit port', s => s.replace(':55439', '')],
  ['zero port', s => s.replace('55439', '0')], ['out of range port', s => s.replace('55439', '99999')],
  ['development database', s => s.replace('ahealth_test', 'ahealth_dev')],
  ['encoded database name', s => s.replace('ahealth_test', 'ahealth%5Ftest')],
  ['wrong protocol', s => s.replace('postgresql:', 'https:')],
  ['host override', s => s + '?host=example.invalid'], ['port override', s => s + '?port=5432'],
  ['database override', s => s + '?dbname=other'], ['schema override', s => s + '?schema=private'],
  ['duplicate schema', s => s + '?schema=public&schema=public'],
  ['URL fragment', s => s + '#other'],
  ['empty user', s => s.replace(`synthetic:${generatedPassword}@`, '')],
  ['multi-host', s => s.replace('127.0.0.1', '127.0.0.1,example.invalid')],
  ['unbounded timeout', s => s + '?connect_timeout=0'],
]) {
  test(`rejects ${label} without leaking URL/password`, () => {
    const env = valid(); env.DATABASE_URL = edit(env.DATABASE_URL);
    assert.throws(() => parse(env), error => !error.message.includes(generatedPassword) && !error.message.includes('postgresql://'));
  });
}
test('allows bounded documented public-schema options', () => {
  const env = valid(); env.DATABASE_URL += '?schema=public&connection_limit=3&connect_timeout=5&pool_timeout=10';
  assert.equal(parse(env).port, 55439);
});
test('accepts matching server identity', () => identity(parse(valid()), row()));
test('accepts mapped loopback address', () => identity(parse(valid()), { ...row(), server_address: '::ffff:127.0.0.1/32' }));
for (const [name, change] of [
  ['wrong database', { database_name: 'ahealth_dev' }], ['other server port', { server_port: 5432 }],
  ['Docker/internal network address', { server_address: '172.18.0.2' }], ['null server address', { server_address: null }],
  ['bad loopback address', { server_address: '127.500.0.1' }], ['not database owner', { database_owner: 'somebody_else' }],
  ['replica', { in_recovery: true }], ['missing current user', { login_role: '' }],
]) {
  test(`rejects metadata: ${name}`, () => assert.throws(() => identity(parse(valid()), { ...row(), ...change })));
}
test('rejects missing metadata row', () => assert.throws(() => identity(parse(valid()), undefined)));
