'use strict';
/**
 * Executes the project's actual createConsultation TypeScript function against
 * in-memory dependency doubles. No database, network, tokens or real users.
 * This is supplemental unit regression coverage, NOT HTTP/DB/E2E validation.
 *
 * Run with AHP_SOURCE_ROOT set to an extracted project containing .
 * TypeScript is resolved from that project's dev dependencies, or NODE_PATH.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');

if (!process.env.AHP_SOURCE_ROOT) throw new Error('Set AHP_SOURCE_ROOT to the source checkout to be tested.');
const root = fs.realpathSync(process.env.AHP_SOURCE_ROOT);
const fromProject = createRequire(path.join(root, 'package.json'));
let ts;
try { ts = fromProject('typescript'); } catch { ts = require('typescript'); }

const patientId = '11111111-1111-4111-8111-111111111111';
const otherPatientId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const guardianId = '44444444-4444-4444-8444-444444444444';
const otherUserId = '55555555-5555-4555-8555-555555555555';
const threadId = '66666666-6666-4666-8666-666666666666';
const consultationId = '77777777-7777-4777-8777-777777777777';
const fixedNow = new Date('2026-10-20T00:00:00.000Z');

function appError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function loadService(dependencies) {
  const filename = path.join(root, 'services/consultation/src/services/consultation.service.ts');
  const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
    fileName: filename,
  });
  assert.equal((diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  const factory = new vm.Script(`(function(require, module, exports) {\n${outputText}\n})`, { filename }).runInThisContext();
  factory((specifier) => {
    if (!Object.hasOwn(dependencies, specifier)) throw new Error(`Unstubbed dependency: ${specifier}`);
    return dependencies[specifier];
  }, module, module.exports);
  return module.exports;
}

function harness({ ownerId = patientId, threadStatus = 'open', missingThread = false, guardian = false } = {}) {
  const state = {
    thread: missingThread ? null : {
      id: threadId, patientProfileId: ownerId, status: threadStatus,
      closedAt: threadStatus === 'closed' ? fixedNow : null,
      outcome: threadStatus === 'closed' ? 'recovered' : null,
      version: 1, openConsultationCount: 0,
    },
    consultations: [],
  };
  const writes = [];
  const changes = [];
  const audits = [];
  const patient = {
    id: patientId, userId: guardian ? otherUserId : userId,
    guardianUserId: guardian ? guardianId : null,
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'), chronicConditions: [],
  };
  const tx = {
    // The post-create routing pass is out of scope. A missing lookup makes
    // the actual routing function stop normally without clinical offers.
    $queryRaw: async () => [],
    careThread: {
      findUnique: async ({ where }) => where.id === threadId ? structuredClone(state.thread) : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, threadId);
        writes.push({ model: 'careThread', data: structuredClone(data) });
        assert.ok(state.thread);
        for (const [key, value] of Object.entries(data)) {
          state.thread[key] = value && typeof value === 'object' && 'increment' in value
            ? (state.thread[key] ?? 0) + value.increment : value;
        }
        return structuredClone(state.thread);
      },
    },
    consultationRequest: {
      findUnique: async () => null,
      create: async ({ data }) => {
        writes.push({ model: 'consultationRequest', data: structuredClone(data) });
        const record = {
          id: consultationId, assignedClinicianId: null, referredFromId: null,
          appointmentId: null, status: 'pending', escalationCount: 0,
          createdAt: fixedNow, updatedAt: fixedNow, acceptedAt: null,
          completedAt: null, version: 1, ...data,
        };
        state.consultations.push(record);
        return record;
      },
    },
  };
  const prisma = {
    patientProfile: { findUnique: async ({ where }) => where.id === patientId ? patient : null },
    $transaction: async (fn) => fn(tx),
  };
  const service = loadService({
    '@a-health/database': { prisma },
    '@a-health/http': {
      appendAudit: async e => audits.push(e), recordChange: async (_tx, e) => changes.push(e),
      forbidden: (code, message) => appError(403, code, message),
      notFound: message => appError(404, 'NOT_FOUND', message),
      conflict: (code, message) => appError(409, code, message),
      cursorArgs: () => ({}), toCursorPage: () => { throw new Error('Not used in this test'); },
    },
    '../config/env.js': { env: {} },
    '../engine/triage.js': {
      triageWith: () => ({ urgency: 'routine', matchedRules: [], recommendedSpecialty: 'general_practice', ruleVersion: 'unit-fixture' }),
      slaSecondsFor: () => 900,
    },
    './ruleset.service.js': { activeRuleset: async () => ({ sla: {}, label: 'unit-fixture' }) },
    '../engine/matching.js': { fanoutFor: () => 0, rank: () => [] },
    '../events.js': { publishConsultationEvent: async () => undefined },
  });
  const caller = { sub: guardian ? guardianId : userId, role: 'patient', ppid: patientId };
  const input = { patient_profile_id: patientId, care_thread_id: threadId, channel: 'app' };
  return { service, state, writes, audits, changes, caller, input };
}

async function assertDeniedWithoutWrites(h, caller = h.caller) {
  await assert.rejects(
    h.service.createConsultation(caller, h.input, {}),
    error => error.status === 403 && error.code === 'NOT_RESOURCE_OWNER',
  );
  assert.equal(h.writes.length, 0, 'Denial must occur before reopening a thread or creating a consultation');
  assert.equal(h.audits.length, 0, 'No successful consultation-created audit');
  assert.equal(h.changes.length, 0, 'No successful changelog writes');
}

test('rejects another patient\'s OPEN care thread before any write', async () => {
  const h = harness({ ownerId: otherPatientId });
  await assertDeniedWithoutWrites(h);
});

test('rejects another patient\'s CLOSED thread without reopening it', async () => {
  const h = harness({ ownerId: otherPatientId, threadStatus: 'closed' });
  await assertDeniedWithoutWrites(h);
  assert.equal(h.state.thread.status, 'closed');
});

test('guardian cannot mix the selected dependent with another dependent\'s thread', async () => {
  const h = harness({ ownerId: otherPatientId, guardian: true });
  await assertDeniedWithoutWrites(h);
});

test('admin role does not waive patient/thread consistency', async () => {
  const h = harness({ ownerId: otherPatientId });
  await assertDeniedWithoutWrites(h, { sub: userId, role: 'platform_admin' });
});

test('patient can still create a consultation on their OWN OPEN thread', async () => {
  const h = harness();
  const response = await h.service.createConsultation(h.caller, h.input, {});
  assert.equal(response.patient_profile_id, patientId);
  assert.equal(response.care_thread_id, threadId);
  assert.equal(h.state.consultations.length, 1);
  assert.equal(h.audits.length, 1);
});

test('patient can still reopen their OWN CLOSED thread', async () => {
  const h = harness({ threadStatus: 'closed' });
  const response = await h.service.createConsultation(h.caller, h.input, {});
  assert.equal(response.patient_profile_id, patientId);
  assert.equal(h.state.thread.status, 'open');
  assert.equal(h.state.thread.closedAt, null);
  assert.equal(h.state.thread.outcome, null);
});

test('guardian can still use the correct dependent and matching thread', async () => {
  const h = harness({ guardian: true });
  const response = await h.service.createConsultation(h.caller, h.input, {});
  assert.equal(response.patient_profile_id, patientId);
  assert.equal(h.state.consultations.length, 1);
});

test('missing thread still returns not found without writes', async () => {
  const h = harness({ missingThread: true });
  await assert.rejects(h.service.createConsultation(h.caller, h.input, {}), e => e.status === 404);
  assert.equal(h.writes.length, 0);
});

test('existing unrelated patient-profile guard remains intact', async () => {
  const h = harness();
  await assertDeniedWithoutWrites(h, { sub: otherUserId, role: 'patient', ppid: patientId });
});
