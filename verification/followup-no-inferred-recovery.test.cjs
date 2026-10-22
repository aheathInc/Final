'use strict';
/**
 * Executes actual TypeScript scheduler/closeCycle source against explicit
 * in-memory database collaborators. No network, DB, credentials or real patient
 * data. This is NOT a Prisma/PostgreSQL, HTTP/JWT, or transaction-atomicity test.
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
if (!process.env.AHP_SOURCE_ROOT) throw new Error('Set AHP_SOURCE_ROOT to the extracted project root.');
const root = fs.realpathSync(process.env.AHP_SOURCE_ROOT);
let ts;
try { ts = createRequire(path.join(root, 'package.json'))('typescript'); }
catch { ts = require('typescript'); }
const clone = (x) => structuredClone(x);
const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = new Date('2031-01-10T12:00:00.000Z');

function load(relative, overrides, cache = new Map()) {
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) throw new Error('Source path must remain inside project root.');
  if (cache.has(file)) return cache.get(file).exports;
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true, fileName: file,
  });
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const mod = { exports: {} }; cache.set(file, mod);
  new vm.Script(`(function(require, module, exports) {\n${compiled.outputText}\n})`, { filename: file })
    .runInThisContext()((specifier) => {
      if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
      if (specifier.startsWith('.')) {
        const target = path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'));
        return load(path.relative(root, target), overrides, cache);
      }
      throw new Error(`Unconfigured dependency: ${specifier}`);
    }, mod, mod.exports);
  return mod.exports;
}
function fixture(overrides = {}) {
  return {
    id: 'synthetic-cycle-a', careThreadId: 'synthetic-thread-a', patientProfileId: 'synthetic-patient-a',
    clinicianId: 'synthetic-clinician-a', sourceConsultationId: 'synthetic-consultation-a',
    frequency: 'daily', customCron: null, questionnaireKey: null, recoveryCriteria: {},
    startDate: new Date(NOW.getTime() - 4 * DAY), endDate: new Date(NOW.getTime() - DAY),
    status: 'active', outcome: null, openDeviationCount: 0, version: 1, updatedAt: new Date(NOW),
    ...overrides,
  };
}
function checkin(cycle, overrides = {}) {
  return {
    id: 'synthetic-checkin-a', followUpCycleId: cycle.id, careThreadId: cycle.careThreadId,
    scheduledAt: new Date(NOW.getTime() - 2 * DAY), status: 'scheduled',
    questions: [], responses: null, isDeviation: false, ...overrides,
  };
}
function equal(a, b) { return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b; }
function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
      return Object.entries(expected).every(([op, value]) => {
        if (op === 'gte') return actual >= value;
        if (op === 'lte') return actual <= value;
        if (op === 'lt') return actual < value;
        if (op === 'equals') return equal(actual, value);
        throw new Error(`Unhandled test-double filter: ${op}`);
      });
    }
    return equal(actual, expected);
  });
}
function apply(row, data) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === 'object' && Object.hasOwn(value, 'increment')
      ? row[key] + value.increment : clone(value);
  }
}
function harness(cycleInput = [], checkinInput = [], threadOverrides = {}) {
  const cycles = clone(cycleInput), rows = clone(checkinInput), calls = [], audits = [];
  const threads = cycles.map(c => ({
    id: c.careThreadId, activeFollowUpCycleId: c.id, ...(threadOverrides[c.careThreadId] || {}),
  }));
  function many(model, data, args) {
    calls.push({ model, operation: 'findMany', args: clone(args) });
    const found = data.filter(r => matches(r, args.where)).slice(0, args.take ?? data.length);
    return clone(args.select
      ? found.map(r => Object.fromEntries(Object.keys(args.select).map(k => [k, r[k]]))) : found);
  }
  function updateMany(model, data, args) {
    calls.push({ model, operation: 'updateMany', args: clone(args) });
    const found = data.filter(r => matches(r, args.where));
    found.forEach(r => apply(r, args.data)); return { count: found.length };
  }
  const prisma = {
    followUpCycle: {
      findMany: async args => many('cycle', cycles, args),
      findUnique: async args => clone(cycles.find(r => matches(r, args.where)) ?? null),
      findUniqueOrThrow: async args => {
        const row = cycles.find(r => matches(r, args.where));
        if (!row) throw new Error('Missing test-double cycle');
        return clone(row);
      },
      updateMany: async args => updateMany('cycle', cycles, args),
      update: async args => {
        calls.push({ model: 'cycle', operation: 'update', args: clone(args) });
        const row = cycles.find(r => matches(r, args.where));
        if (!row) throw new Error('Test-double cycle not found');
        apply(row, args.data); return clone(row);
      },
    },
    careThread: { updateMany: async args => updateMany('thread', threads, args) },
    checkIn: {
      findMany: async args => many('checkin', rows, args),
      createMany: async args => {
        calls.push({ model: 'checkin', operation: 'createMany', args: clone(args) });
        for (const row of args.data) rows.push({ id: `synthetic-new-${rows.length}`, status: 'scheduled', ...clone(row) });
        return { count: args.data.length };
      },
      updateMany: async args => updateMany('checkin', rows, args),
    },
    // Deliberately not a transaction/rollback emulator; atomicity is not tested.
    $transaction: async action => typeof action === 'function' ? action(prisma) : Promise.all(action),
  };
  const httpError = (status) => (code, message) => Object.assign(new Error(message || code), { code, status });
  const overrides = {
    '@a-health/database': { prisma },
    '@a-health/logger': { createLogger: () => ({ warn() {}, info() {}, error() {} }) },
    '@a-health/http': {
      appendAudit: async value => audits.push(clone(value)), conflict: httpError(409),
      forbidden: httpError(403), notFound: httpError(404),
      cursorArgs: () => ({}), toCursorPage: () => { throw new Error('Not used'); },
    },
    '../config/env.js': { env: { SCHEDULE_HORIZON_DAYS: 2, MISSED_AFTER_HOURS: 24, SCHEDULER_INTERVAL_MINUTES: 15 } },
  };
  const { tick } = load('services/followup/src/workers/scheduler.worker.ts', overrides);
  const { closeCycle } = load('services/followup/src/services/checkin.service.ts', overrides);
  return { tick, closeCycle, cycles, rows, threads, calls, audits };
}
function assertNotClosed(h, expected) {
  const row = h.cycles.find(c => c.id === expected.id);
  assert.equal(row.status, 'active');
  assert.equal(row.outcome, expected.outcome);
  assert.equal(row.version, expected.version);
  assert.equal(h.threads.find(t => t.id === expected.careThreadId).activeFollowUpCycleId, expected.id);
  assert.equal(h.calls.filter(c => c.model === 'cycle' && c.operation === 'update').length, 0);
  assert.equal(h.calls.filter(c => c.model === 'thread' && c.operation === 'updateMany').length, 0);
}

test('ended cycle with no responses remains active; no outcome is invented', async () => {
  const c = fixture(), h = harness([c]);
  await h.tick(NOW); assertNotClosed(h, c);
});
test('zero recorded deviations plus a normal response does not establish recovery', async () => {
  const c = fixture(), h = harness([c], [checkin(c, { status: 'responded', responses: { synthetic_check: 'acknowledged' } })]);
  await h.tick(NOW); assertNotClosed(h, c); assert.equal(h.rows[0].status, 'responded');
});
test('missed check-ins do not create recovered or lost_to_follow_up outcomes', async () => {
  const c = fixture(), h = harness([c], [checkin(c, { status: 'missed' })]);
  await h.tick(NOW); assertNotClosed(h, c);
});
test('an unresolved deviation remains active and linked after window end', async () => {
  const c = fixture({ openDeviationCount: 1 }), h = harness([c]);
  await h.tick(NOW); assertNotClosed(h, c);
});
test('repeated ticks do not change ended-cycle version or care-thread linkage', async () => {
  const c = fixture(), h = harness([c]);
  await h.tick(NOW); await h.tick(new Date(NOW.getTime() + HOUR)); assertNotClosed(h, c);
});
test('cyclesAutoClosed is retained as zero, with the existing result keys', async () => {
  const h = harness([fixture()]), result = await h.tick(NOW);
  assert.deepEqual(Object.keys(result).sort(), ['checkInsCreated', 'cyclesAutoClosed', 'cyclesProcessed']);
  assert.equal(result.cyclesAutoClosed, 0);
});
test('ended cycles are filtered before the 500-row scheduler batch', async () => {
  const ended = Array.from({ length: 501 }, (_, i) => fixture({ id: `synthetic-ended-${i}`, careThreadId: `synthetic-ended-thread-${i}` }));
  const due = fixture({ id: 'synthetic-in-window', careThreadId: 'synthetic-in-window-thread', startDate: NOW, endDate: new Date(NOW.getTime() + DAY) });
  const h = harness([...ended, due]), result = await h.tick(NOW);
  assert.ok(h.rows.some(r => r.followUpCycleId === due.id), 'due cycle must not be starved by ended cycles');
  assert.equal(result.cyclesProcessed, 1);
});
test('ended cycles receive no new scheduled check-ins', async () => {
  const c = fixture(), h = harness([c]); await h.tick(NOW);
  assert.equal(h.rows.length, 0);
});
test('overdue unanswered check-in becomes missed without closing its cycle', async () => {
  const c = fixture(), h = harness([c], [checkin(c)]); await h.tick(NOW);
  assert.equal(h.rows[0].status, 'missed'); assertNotClosed(h, c);
});
test('response rows and the exact missed cutoff remain unchanged', async () => {
  const c = fixture({ openDeviationCount: 1 });
  const h = harness([c], [
    checkin(c, { id: 'responded', status: 'responded' }),
    checkin(c, { id: 'cutoff', scheduledAt: new Date(NOW.getTime() - DAY) }),
  ]);
  await h.tick(NOW);
  assert.equal(h.rows[0].status, 'responded'); assert.equal(h.rows[1].status, 'scheduled');
});
for (const [frequency, intervalHours, expected] of [['daily', 24, 3], ['twice_daily', 12, 5], ['weekly', 168, 1]]) {
  test(`in-window ${frequency} schedule retains its existing frequency`, async () => {
    const c = fixture({ frequency, startDate: NOW, endDate: new Date(NOW.getTime() + 10 * DAY) });
    const h = harness([c]), result = await h.tick(NOW);
    assert.equal(result.checkInsCreated, expected);
    assert.equal(h.rows.length, expected);
    for (let i = 1; i < h.rows.length; i++) assert.equal(h.rows[i].scheduledAt - h.rows[i - 1].scheduledAt, intervalHours * HOUR);
    assert.equal(h.cycles[0].outcome, null);
  });
}
test('check-ins never extend beyond the current cycle end', async () => {
  const c = fixture({ startDate: NOW, endDate: new Date(NOW.getTime() + DAY) }), h = harness([c]);
  await h.tick(NOW); assert.equal(h.rows.length, 2);
  assert.ok(h.rows.every(r => r.scheduledAt <= c.endDate));
});
test('sequential scheduling ticks skip existing slots', async () => {
  const c = fixture({ startDate: NOW, endDate: new Date(NOW.getTime() + 3 * DAY) }), h = harness([c]);
  const first = await h.tick(NOW), second = await h.tick(NOW);
  assert.equal(first.checkInsCreated, 3); assert.equal(second.checkInsCreated, 0); assert.equal(h.rows.length, 3);
});
test('the exact end instant retains the inclusive scheduling boundary', async () => {
  const c = fixture({ startDate: new Date(NOW.getTime() - DAY), endDate: NOW }), h = harness([c]);
  await h.tick(NOW);
  assert.equal(h.rows.length, 1); assert.equal(h.rows[0].scheduledAt.getTime(), NOW.getTime());
  assertNotClosed(h, c);
});
test('previously completed cycles are not rewritten or scheduled', async () => {
  const c = fixture({ status: 'completed', outcome: 'recovered' }), h = harness([c]);
  await h.tick(NOW);
  assert.deepEqual(h.cycles[0], c); assert.equal(h.rows.length, 0);
});
test('the assigned clinician can still explicitly close an ended cycle', async () => {
  const c = fixture(), h = harness([c]); await h.tick(NOW);
  const result = await h.closeCycle(c.id, { sub: 'synthetic-clinician-user', role: 'clinician', cpid: c.clinicianId }, 'recovered', undefined, {});
  assert.equal(result.status, 'completed'); assert.equal(result.outcome, 'recovered');
  assert.equal(h.threads[0].activeFollowUpCycleId, null);
  assert.equal(h.audits[0].action, 'followup.cycle_closed');
});
test('patient caller cannot close the cycle through the existing manual service', async () => {
  const c = fixture(), h = harness([c]);
  await assert.rejects(() => h.closeCycle(c.id, { sub: 'synthetic-patient-user', role: 'patient' }, 'recovered', undefined, {}), e => e.code === 'NOT_RESOURCE_OWNER');
  assertNotClosed(h, c);
});
test('unrelated clinician cannot record the outcome', async () => {
  const c = fixture(), h = harness([c]);
  await assert.rejects(() => h.closeCycle(c.id, { sub: 'synthetic-outsider', role: 'clinician', cpid: 'synthetic-other-clinician' }, 'recovered', undefined, {}), e => e.code === 'NOT_RESOURCE_OWNER');
  assertNotClosed(h, c);
});
test('existing platform-admin explicit-close policy remains unchanged', async () => {
  const c = fixture(), h = harness([c]);
  const result = await h.closeCycle(c.id, { sub: 'synthetic-admin', role: 'platform_admin' }, 'escalated', undefined, {});
  assert.equal(result.status, 'completed'); assert.equal(result.outcome, 'escalated');
});
test('explicit close cannot clear a different active follow-up pointer', async () => {
  const c = fixture(), h = harness([c], [], { [c.careThreadId]: { activeFollowUpCycleId: 'synthetic-other-cycle' } });
  await h.closeCycle(c.id, { sub: 'synthetic-clinician-user', role: 'clinician', cpid: c.clinicianId }, 'escalated', undefined, {});
  assert.equal(h.threads[0].activeFollowUpCycleId, 'synthetic-other-cycle');
});
