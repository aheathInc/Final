'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lib/load-typescript.cjs');
const policy = load('services/surveillance/src/services/admin-analytics.policy.ts');
function fixture() {
  let calls = 0;
  const result = value => async () => { calls++; return value; };
  let query = 0;
  const prisma = {
    patientProfile: { count: result(11), groupBy: result([]) },
    facility: { count: result(2) }, consultationRequest: { count: result(13) },
    consultationNote: { count: result(3) },
    $queryRaw: async () => { calls++; return [[], [], [
      { label: '2026-09', count: 3n }, { label: '2026-10', count: 10n },
    ]][query++]; },
  };
  const service = load('services/surveillance/src/services/admin-analytics.service.ts', {
    '@a-health/database': { prisma },
    '@a-health/http': { forbidden: code => Object.assign(new Error('Denied'), { code }) },
    './admin-analytics.policy.js': policy,
  });
  return { service, calls: () => calls };
}
test('executive analytics rejects other roles before database access', async () => {
  for (const role of ['patient', 'researcher', 'clinician', 'facility_admin']) {
    const f = fixture();
    await assert.rejects(() => f.service.getAdminAnalytics(role, 90), { code: 'ROLE_NOT_PERMITTED' });
    assert.equal(f.calls(), 0);
  }
});
test('clinical totals cannot reveal a suppressed monthly count by subtraction', async () => {
  const report = await fixture().service.getAdminAnalytics('platform_admin', 90);
  assert.equal(report.coverage.patientProfiles, policy.patientTotalBand(11));
  assert.equal(report.coverage.consultationRequests, policy.patientTotalBand(13));
  assert.equal(report.coverage.signedNotesInPeriod, 'Under 10');
  assert.deepEqual(report.monthlyConsultations.map(x => x.label), ['2026-09', '2026-10']);
  assert.equal(report.monthlyConsultations[0].count, null);
  assert.equal(report.monthlyConsultations[0].suppressed, true);
});
