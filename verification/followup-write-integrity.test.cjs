'use strict';
/**
 * Actual service source + explicit dependency doubles. No PostgreSQL, HTTP/JWT,
 * clock scheduling, or end-to-end claim. The row-lock/rollback simulator below
 * exercises application interleavings only; real DB regressions are separate.
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
if (!process.env.AHP_SOURCE_ROOT) throw new Error('AHP_SOURCE_ROOT is required.');
const root = fs.realpathSync(process.env.AHP_SOURCE_ROOT);
let ts;
try { ts = createRequire(path.join(root, 'package.json'))('typescript'); }
catch { ts = require('typescript'); }
const copy = x => structuredClone(x);
const fixed = new Date('2031-01-01T12:00:00Z');
const meta = { requestId: 'synthetic-regression' };
const patient = { sub: 'synthetic-user-a', role: 'patient' };
const guardian = { sub: 'synthetic-guardian', role: 'patient' };
const clinician = { sub: 'synthetic-clinician-user', role: 'clinician', cpid: 'synthetic-clinician' };
const admin = { sub: 'synthetic-admin', role: 'platform_admin' };
const outsider = { sub: 'synthetic-outsider', role: 'patient' };

function load(relative, dependencies, cache = new Map()) {
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) throw new Error('Source must stay inside candidate.');
  if (cache.has(file)) return cache.get(file).exports;
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
    reportDiagnostics: true,
  });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const m = { exports: {} }; cache.set(file, m);
  new vm.Script(`(function(require,module,exports){${result.outputText}\n})`, { filename: file })
    .runInThisContext()((specifier) => {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      if (specifier.startsWith('.')) return load(path.relative(root,
        path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'))), dependencies, cache);
      throw new Error(`Unconfigured dependency ${specifier}`);
    }, m, m.exports);
  return m.exports;
}
function fixture(options) {
  const cycle = {
    id: 'synthetic-cycle', careThreadId: 'synthetic-thread', patientProfileId: 'synthetic-profile-a',
    clinicianId: clinician.cpid, sourceConsultationId: 'synthetic-consultation', frequency: 'daily',
    customCron: null, questionnaireKey: null, recoveryCriteria: { red_flag_fields: ['synthetic_attention'] },
    startDate: fixed, endDate: new Date('2031-01-08T12:00:00Z'), status: 'active', outcome: null,
    openDeviationCount: 0, version: 1, updatedAt: fixed,
    patient: { userId: patient.sub, guardianUserId: guardian.sub },
    ...options.cycle,
  };
  return {
    cycles: [cycle], threads: [{ id: cycle.careThreadId, activeFollowUpCycleId: cycle.id, ...options.thread }],
    checkins: options.missingCheckIn ? [] : [{
      id: 'synthetic-checkin', followUpCycleId: cycle.id, careThreadId: cycle.careThreadId,
      scheduledAt: fixed, status: 'scheduled', questions: [], responses: null, isDeviation: false,
      deviationReasons: [], reviewedById: null, reviewedAt: null, respondedAt: null, channel: null,
      version: 1, updatedAt: fixed, ...options.checkin,
    }], audits: [],
  };
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      throw new Error('Unexpected filter in test double.');
    }
    return row[key] === value;
  });
}
function apply(row, data) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === 'object' && 'increment' in value
      ? row[key] + value.increment : copy(value);
  }
}
function harness(options = {}) {
  const state = fixture(options), auditCalls = [], calls = [];
  const lockTails = new Map(); let transactionId = 0, reads = 0, releaseRead;
  const readBarrier = new Promise(resolve => { releaseRead = resolve; });
  const modelTables = { checkIn: 'checkins', followUpCycle: 'cycles', careThread: 'threads' };
  let failAudit = options.failAudit ?? false, failCycle = options.failCycle ?? false;
  async function lock(tx, table, id) {
    const key = `${table}:${id}`;
    if (tx.held.has(key)) return;
    const prior = lockTails.get(key) || Promise.resolve();
    let release;
    const done = new Promise(resolve => { release = resolve; });
    const tail = prior.then(() => done); lockTails.set(key, tail);
    await prior; tx.held.add(key); tx.releases.push(release);
  }
  async function transaction(callback, txOptions) {
    const tx = { id: ++transactionId, held: new Set(), releases: [], undo: [], auditIds: [] };
    const api = client(tx); calls.push({ operation: 'transaction', options: txOptions });
    try { return await callback(api); }
    catch (e) {
      for (const [row, before] of tx.undo.reverse()) { for (const k of Object.keys(row)) delete row[k]; Object.assign(row, before); }
      state.audits = state.audits.filter(a => !tx.auditIds.includes(a.id));
      throw e;
    } finally { for (const release of tx.releases.reverse()) release(); }
  }
  function client(tx) {
    const api = { __testTransaction: tx };
    for (const [model, table] of Object.entries(modelTables)) {
      api[model] = {
        async findUnique(args) {
          calls.push({ operation: 'read', model, tx: tx?.id ?? null });
          const row = state[table].find(r => matches(r, args.where));
          const result = row ? copy(row) : null;
          if (result && args.include?.followUpCycle) result.followUpCycle = copy(state.cycles.find(c => c.id === row.followUpCycleId));
          if (options.barrierModel === model && reads < 2) {
            reads++; if (reads === 2) releaseRead(); await readBarrier;
          }
          return result;
        },
        async findUniqueOrThrow(args) {
          const result = await api[model].findUnique(args);
          if (!result) throw new Error('Missing synthetic row.');
          return result;
        },
        async updateMany(args) {
          if (!tx) return transaction(t => t[model].updateMany(args));
          let count = 0;
          for (const row of state[table]) {
            if (args.where.id && row.id !== args.where.id) continue;
            await lock(tx, table, row.id);
            if (!matches(row, args.where)) continue;
            if (failCycle && model === 'followUpCycle') throw new Error('Synthetic cycle write failure.');
            tx.undo.push([row, copy(row)]); apply(row, args.data); count++;
          }
          calls.push({ operation: 'updateMany', model, count, tx: tx.id });
          return { count };
        },
        async update(args) {
          if (!tx) return transaction(t => t[model].update(args));
          const result = await api[model].updateMany(args);
          if (result.count !== 1) throw new Error('Missing synthetic row for update.');
          return copy(state[table].find(row => row.id === args.where.id));
        },
      };
    }
    api.$queryRaw = async (parts, ...values) => {
      assert.ok(tx, 'row lock requires an actual transaction collaborator');
      assert.match(parts.join('?'), /SELECT id FROM follow_up_cycles.*FOR UPDATE/s);
      const row = state.cycles.find(c => c.id === values[0]);
      if (!row) return [];
      await lock(tx, 'cycles', row.id);
      calls.push({ operation: 'cycle-lock', tx: tx.id });
      return [{ id: row.id }];
    };
    api.$transaction = transaction;
    return api;
  }
  const prisma = client(null);
  const error = status => (code, message) => Object.assign(new Error(message || code), { code, status });
  const service = load('services/followup/src/services/checkin.service.ts', {
    '@a-health/database': { prisma },
    '@a-health/http': {
      conflict: error(409), forbidden: error(403), notFound: error(404),
      cursorArgs: () => ({}), toCursorPage: () => { throw new Error('Not part of these tests.'); },
      appendAudit: async (value, transactionClient) => {
        const tx = transactionClient?.__testTransaction;
        auditCalls.push({ input: copy(value), transactionId: tx?.id ?? null });
        if (failAudit) throw new Error('Synthetic audit failure.');
        const row = { id: `audit-${auditCalls.length}`, input: copy(value) }; state.audits.push(row);
        if (tx) tx.auditIds.push(row.id);
      },
    },
  });
  return {
    state, auditCalls, calls,
    answer: (caller = patient, responses = { synthetic_attention: true }) => service.respondToCheckIn('synthetic-checkin', caller, { responses }, meta),
    close: (caller = clinician, outcome = 'escalated') => service.closeCycle('synthetic-cycle', caller, outcome, undefined, meta),
    failAudit: value => { failAudit = value; },
    failCycle: value => { failCycle = value; },
  };
}
function singleWinner(results, code) {
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const loser = results.find(r => r.status === 'rejected');
  assert.equal(loser.reason.code, code);
  assert.equal(loser.reason.status, 409);
}

test('owner response keeps existing API shape and records one deviation', async () => {
  const h = harness(); const r = await h.answer();
  assert.equal(r.status, 'responded'); assert.equal(r.is_deviation, true);
  assert.equal(r.follow_up_cycle_id, 'synthetic-cycle');
  assert.equal(h.state.cycles[0].openDeviationCount, 1); assert.equal(h.state.checkins[0].version, 2);
});
test('guardian response remains supported', async () => {
  const h = harness(); assert.equal((await h.answer(guardian)).status, 'responded');
});
test('existing admin response authorization is unchanged', async () => {
  const h = harness(); assert.equal((await h.answer(admin)).status, 'responded');
});
test('outsider cannot answer another patient check-in', async () => {
  const h = harness(), before = copy(h.state);
  await assert.rejects(h.answer(outsider), e => e.code === 'NOT_RESOURCE_OWNER'); assert.deepEqual(h.state, before);
});
test('clinician has no newly granted response write privilege', async () => {
  const h = harness(); await assert.rejects(h.answer(clinician), e => e.code === 'NOT_RESOURCE_OWNER');
});
test('missing check-in returns not-found without writes', async () => {
  const h = harness({ missingCheckIn: true }); await assert.rejects(h.answer(), e => e.status === 404); assert.equal(h.state.audits.length, 0);
});
test('a late response to a missed check-in still works', async () => {
  const h = harness({ checkin: { status: 'missed' } }); assert.equal((await h.answer()).status, 'responded');
});
test('normal response does not invent a deviation', async () => {
  const h = harness(); const r = await h.answer(patient, { synthetic_attention: false });
  assert.equal(r.is_deviation, false); assert.equal(h.state.cycles[0].openDeviationCount, 0); assert.equal(h.state.audits.length, 0);
});
test('a sequential retry cannot replace a response', async () => {
  const h = harness(); await h.answer(); const before = copy(h.state);
  await assert.rejects(h.answer(patient, { synthetic_attention: false }), e => e.code === 'CHECK_IN_ALREADY_ANSWERED'); assert.deepEqual(h.state, before);
});
test('two requests that both read scheduled produce one response and one count', async () => {
  const h = harness({ barrierModel: 'checkIn' }); const results = await Promise.allSettled([h.answer(), h.answer()]);
  singleWinner(results, 'CHECK_IN_ALREADY_ANSWERED'); assert.equal(h.state.cycles[0].openDeviationCount, 1);
  assert.equal(h.state.checkins[0].version, 2); assert.equal(h.state.audits.length, 1);
});
test('concurrent distinct responses preserve only the winning response', async () => {
  const h = harness({ barrierModel: 'checkIn' });
  const first = { synthetic_attention: true, synthetic_request: 'a' };
  const second = { synthetic_attention: false, synthetic_request: 'b' };
  const results = await Promise.allSettled([h.answer(patient, first), h.answer(patient, second)]);
  singleWinner(results, 'CHECK_IN_ALREADY_ANSWERED');
  const winner = results.find(r => r.status === 'fulfilled').value;
  assert.deepEqual(h.state.checkins[0].responses, winner.responses);
  assert.equal(h.state.cycles[0].openDeviationCount, winner.is_deviation ? 1 : 0);
});
test('required deviation audit uses the caller transaction', async () => {
  const h = harness(); await h.answer(); assert.ok(h.auditCalls[0].transactionId !== null);
});
test('deviation audit failure rolls back response, version and deviation count in the double', async () => {
  const h = harness({ failAudit: true }), before = copy(h.state);
  await assert.rejects(h.answer(), /Synthetic audit failure/); assert.deepEqual(h.state, before);
});
test('cycle-write failure rolls back a response in the double', async () => {
  const h = harness({ failCycle: true }), before = copy(h.state);
  await assert.rejects(h.answer(), /Synthetic cycle write failure/); assert.deepEqual(h.state, before);
});
test('retry after a rolled-back audit failure remains possible', async () => {
  const h = harness({ failAudit: true }); await assert.rejects(h.answer()); h.failAudit(false);
  assert.equal((await h.answer()).status, 'responded'); assert.equal(h.state.checkins[0].version, 2);
  assert.equal(h.state.cycles[0].openDeviationCount, 1);
});
test('audit metadata omits clinical response values; protected check-in retains reasons', async () => {
  const h = harness({ cycle: { recoveryCriteria: { vital_bounds: { synthetic_measurement: { max: 10 } } } } });
  const r = await h.answer(patient, { synthetic_measurement: 1234567 });
  assert.equal(r.is_deviation, true); assert.ok(JSON.stringify(r.deviation_reasons).includes('1234567'));
  const audit = h.auditCalls[0].input; assert.equal(audit.metadata.reasonCount, 1);
  assert.ok(!JSON.stringify(audit).includes('1234567')); assert.ok(!('reasons' in audit.metadata));
});
test('assigned clinician explicit close preserves the existing outcome workflow', async () => {
  const h = harness(); const r = await h.close();
  assert.equal(r.status, 'completed'); assert.equal(r.outcome, 'escalated');
  assert.equal(h.state.threads[0].activeFollowUpCycleId, null); assert.equal(h.state.checkins[0].status, 'missed');
});
test('closure ledger append uses the same transaction', async () => {
  const h = harness(); await h.close(); assert.ok(h.auditCalls[0].transactionId !== null);
});
test('patient cannot close a follow-up cycle', async () => {
  const h = harness(), before = copy(h.state); await assert.rejects(h.close(patient), e => e.code === 'NOT_RESOURCE_OWNER'); assert.deepEqual(h.state, before);
});
test('unrelated clinician cannot close a cycle', async () => {
  const h = harness(); await assert.rejects(h.close({ ...clinician, cpid: 'synthetic-other' }), e => e.code === 'NOT_RESOURCE_OWNER');
});
test('closed cycle cannot be assigned a second outcome', async () => {
  const h = harness(); await h.close(); const before = copy(h.state);
  await assert.rejects(h.close(clinician, 'recovered'), e => e.code === 'FOLLOW_UP_CYCLE_CLOSED'); assert.deepEqual(h.state, before);
});
test('concurrent closures preserve one outcome and one closure audit', async () => {
  const h = harness({ barrierModel: 'followUpCycle' });
  const results = await Promise.allSettled([h.close(clinician, 'recovered'), h.close(clinician, 'escalated')]);
  singleWinner(results, 'FOLLOW_UP_CYCLE_CLOSED'); assert.equal(h.state.cycles[0].version, 2);
  assert.equal(h.state.audits.length, 1);
  assert.equal(h.state.cycles[0].outcome, results.find(r => r.status === 'fulfilled').value.outcome);
});
test('closure audit failure restores cycle, thread and check-ins in the double', async () => {
  const h = harness({ failAudit: true }), before = copy(h.state);
  await assert.rejects(h.close(), /Synthetic audit failure/); assert.deepEqual(h.state, before);
});
test('closure does not clear another active cycle pointer', async () => {
  const h = harness({ thread: { activeFollowUpCycleId: 'synthetic-newer-cycle' } }); await h.close();
  assert.equal(h.state.threads[0].activeFollowUpCycleId, 'synthetic-newer-cycle');
});
test('new operations declare finite transaction bounds', async () => {
  const h = harness(); await h.answer(); await h.close();
  for (const c of h.calls.filter(c => c.operation === 'transaction')) {
    assert.equal(c.options?.maxWait, 10000); assert.equal(c.options?.timeout, 10000);
  }
});

test('response acquires cycle lock before check-in mutation, matching closure lock order', async () => {
  const h = harness(); await h.answer();
  const lockAt = h.calls.findIndex(c => c.operation === 'cycle-lock');
  const writeAt = h.calls.findIndex(c => c.operation === 'updateMany' && c.model === 'checkIn');
  assert.ok(lockAt >= 0 && lockAt < writeAt);
});
