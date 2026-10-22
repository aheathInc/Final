'use strict';
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { lfHash, parseOptions, redact, tapCounts, testPassed, preflight } = require('./verify-safety.cjs');
const passing = '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
test('defaults to static-only mode', () => assert.equal(parseOptions(['--root', '.']).run, false));
test('requires explicit --run for tests', () => assert.equal(parseOptions(['--root', '.', '--run']).run, true));
test('accepts explicit --check', () => assert.equal(parseOptions(['--root', '.', '--check']).run, false));
for (const [label, args] of [
  ['no root', []], ['missing root value', ['--root']], ['unknown option', ['--root', '.', '--force']],
  ['duplicate root', ['--root', '.', '--root', '.']], ['conflicting modes', ['--root', '.', '--run', '--check']],
]) test(`rejects ${label}`, () => assert.throws(() => parseOptions(args)));
test('normalizes CRLF for source fingerprint', () => assert.equal(lfHash('a\r\nb\r\n'), lfHash('a\nb\n')));
test('counts complete TAP success', () => assert.equal(testPassed(0, passing), true));
test('nonzero process cannot pass', () => assert.equal(testPassed(1, passing), false));
test('missing summary cannot pass', () => assert.equal(testPassed(0, 'ok 1'), false));
test('zero tests cannot pass', () => assert.equal(testPassed(0, passing.replace('tests 2', 'tests 0').replace('pass 2', 'pass 0')), false));
test('skipped tests cannot pass', () => assert.equal(testPassed(0, passing.replace('skipped 0', 'skipped 1')), false));
test('cancelled tests cannot pass', () => assert.equal(testPassed(0, passing.replace('cancelled 0', 'cancelled 1')), false));
test('TODO tests cannot pass', () => assert.equal(testPassed(0, passing.replace('todo 0', 'todo 1')), false));
test('assertion failures cannot pass', () => assert.equal(testPassed(0, passing.replace('fail 0', 'fail 1')), false));
test('reads final TAP counts', () => assert.equal(tapCounts(passing + passing.replace('tests 2', 'tests 3')).tests, 3));
test('redacts process secrets and encoded database password', () => {
  const secret = randomBytes(24).toString('hex'); const password = `${randomBytes(16).toString('hex')}!@`;
  const url = `postgresql://local:${encodeURIComponent(password)}@127.0.0.1:55439/ahealth_test`;
  const output = redact(`url=${url} secret=${secret} decoded=${password}`, { DATABASE_URL: url, JWT_SECRET: secret });
  assert.ok(!output.includes(secret)); assert.ok(!output.includes(password)); assert.ok(!output.includes(url));
});
test('redacts credential URLs even without env match', () => {
  const password = randomBytes(16).toString('hex');
  assert.ok(!redact(`postgresql://test:${password}@127.0.0.1:55439/ahealth_test`, {}).includes(password));
});
test('redacts bearer values', () => {
  const token = randomBytes(24).toString('hex'); assert.ok(!redact(`Bearer ${token}`, {}).includes(token));
});
test('retains useful TAP diagnostics', () => assert.equal(redact(passing, {}), passing));
test('source absence blocks preflight', () => {
  const r = preflight('/nonexistent-review-checkout', { source_lf_sha256: { 'x.ts': 'missing' }, tools: {} });
  assert.ok(r.problems.some(s => s.startsWith('SOURCE_MISSING'))); assert.ok(r.problems.includes('WORKSPACE_MANIFEST_MISSING'));
});
