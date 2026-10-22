import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { verifyAuditChain } from '@a-health/http';
import {
  activateSystem, authenticateIntegration, confirmIdentity, getExternalRecordDetail,
  getMyTimeline, getPatientTimeline, importFhirResource, listPendingIdentities,
  markIdentityAmbiguous, registerSystem, rejectIdentity,
} from '../services/interop.service.js';

const rawDatabaseUrl = process.env.DATABASE_URL ?? '';
let target: URL;
try { target = new URL(rawDatabaseUrl); } catch {
  throw new Error('Refusing interoperability database tests without a configured isolated ahealth_test DATABASE_URL.');
}
const targetDatabase = decodeURIComponent(target.pathname.replace(/^\//, ''));
const targetSchema = target.searchParams.get('schema');
const isolatedTarget = (targetDatabase === 'ahealth_test' && targetSchema === 'public') ||
  (targetDatabase === 'ahealth_dev' && /^ahp_test_[a-z0-9_]+$/.test(targetSchema ?? ''));
if (
  !isolatedTarget || target.searchParams.getAll('schema').length !== 1 ||
  !['localhost', '127.0.0.1', '::1'].includes(target.hostname) ||
  (target.port || '5432') === '5432'
) {
  throw new Error('Refusing interoperability tests unless DATABASE_URL targets an isolated local test database/schema on a non-5432 port.');
}

before(async () => {
  const [identity] = await prisma.$queryRaw<Array<{ db: string; schema: string; schemaOwner: string; role: string; port: number; address: string }>>`
    SELECT current_database() AS db, current_schema()::text AS schema,
           (SELECT pg_get_userbyid(nspowner)::text FROM pg_namespace WHERE nspname = current_schema()) AS "schemaOwner",
           current_user::text AS role, inet_server_port() AS port, inet_server_addr()::text AS address`;
  const address = (identity?.address ?? '').toLowerCase().replace(/^::ffff:/, '').replace(/\/\d+$/, '');
  if (!identity || identity.db !== targetDatabase || identity.schema !== targetSchema ||
      identity.schemaOwner !== identity.role || identity.port !== Number(target.port) ||
      !(/^(127\.\d+\.\d+\.\d+|::1)$/.test(address))) {
    throw new Error('Interoperability database/schema identity or ownership check failed.');
  }
});

const meta = { ip: '127.0.0.1', requestId: 'interop-test' };
const cleanup = { externalSystemId: '', facilityId: '', userIds: [] as string[], clinicianIds: [] as string[], profileIds: [] as string[], consentIds: [] as string[] };
const tokenEnvNames: string[] = [];

after(async () => {
  if (cleanup.externalSystemId) {
    await prisma.externalFhirResource.deleteMany({ where: { externalSystemId: cleanup.externalSystemId } }).catch(() => undefined);
    await prisma.externalPatientIdentity.deleteMany({ where: { externalSystemId: cleanup.externalSystemId } }).catch(() => undefined);
    await prisma.externalHealthSystem.delete({ where: { id: cleanup.externalSystemId } }).catch(() => undefined);
  }
  if (cleanup.consentIds.length) await prisma.patientConsent.deleteMany({ where: { id: { in: cleanup.consentIds } } }).catch(() => undefined);
  if (cleanup.profileIds.length) await prisma.patientProfile.deleteMany({ where: { id: { in: cleanup.profileIds } } }).catch(() => undefined);
  if (cleanup.clinicianIds.length) await prisma.clinicianProfile.deleteMany({ where: { id: { in: cleanup.clinicianIds } } }).catch(() => undefined);
  if (cleanup.facilityId) await prisma.facility.delete({ where: { id: cleanup.facilityId } }).catch(() => undefined);
  if (cleanup.userIds.length) await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } }).catch(() => undefined);
  for (const name of tokenEnvNames) delete process.env[name];
  await prisma.$disconnect();
});

async function createUser(role: 'platform_admin' | 'patient' | 'clinician', label: string) {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+255${randomInt(700_000_000, 799_999_999)}`,
      email: `${label}-${randomUUID()}@test.invalid`, role, status: 'active', fullName: `Synthetic ${label}`,
    },
  });
  cleanup.userIds.push(user.id);
  return user;
}

function observation(versionId: string, lastUpdated: string, eventAt: string, patientId: string, id = 'observation-a') {
  return {
    resourceType: 'Observation', id,
    meta: { versionId, lastUpdated }, status: 'final', code: { text: 'TEST ONLY' },
    subject: { reference: `Patient/${patientId}` }, effectiveDateTime: eventAt,
    valueString: 'Synthetic fixture only',
  };
}

function startBarrier(participants: number) {
  let arrivals = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === participants) release();
    await opened;
  };
}

describe('interoperability isolated database workflow', () => {
  it('registers and authenticates a synthetic source, quarantines and reconciles identities, enforces isolation and consent, versions imports, and preserves audit integrity', async () => {
    const admin = await createUser('platform_admin', 'admin');
    const patientAUser = await createUser('patient', 'patient-a');
    const patientBUser = await createUser('patient', 'patient-b');
    const clinicianAUser = await createUser('clinician', 'clinician-authorized');
    const clinicianBUser = await createUser('clinician', 'clinician-unrelated');
    const facility = await prisma.facility.create({ data: { name: `Synthetic Interop Facility ${randomUUID().slice(0, 8)}`, type: 'hospital' } });
    cleanup.facilityId = facility.id;
    const patientA = await prisma.patientProfile.create({ data: { userId: patientAUser.id, fullName: 'Synthetic Patient A' } });
    const patientB = await prisma.patientProfile.create({ data: { userId: patientBUser.id, fullName: 'Synthetic Patient B' } });
    cleanup.profileIds.push(patientA.id, patientB.id);
    const nativeRecord = await prisma.medicalRecord.create({
      data: {
        patientProfileId: patientA.id, recordType: 'other',
        title: 'TEST DATA ONLY - NOT FOR CLINICAL USE',
        body: 'Synthetic native timeline sentinel.', recordedAt: new Date(),
      },
    });
    const clinicianA = await prisma.clinicianProfile.create({ data: { userId: clinicianAUser.id, facilityId: facility.id, licenseNumber: `TEST-${randomUUID()}`, specialty: 'general_practice', verificationStatus: 'verified' } });
    const clinicianB = await prisma.clinicianProfile.create({ data: { userId: clinicianBUser.id, facilityId: facility.id, licenseNumber: `TEST-${randomUUID()}`, specialty: 'general_practice', verificationStatus: 'verified' } });
    cleanup.clinicianIds.push(clinicianA.id, clinicianB.id);
    const consent = await prisma.patientConsent.create({
      data: { patientProfileId: patientA.id, granteeType: 'clinician', granteeClinicianId: clinicianA.id, scope: 'full_history' },
    });
    cleanup.consentIds.push(consent.id);

    const systemKey = `test-${randomUUID().slice(0, 8)}`;
    const tokenName = `INTEROP_SYSTEM_TOKEN_${systemKey.toUpperCase().replace(/-/g, '_')}`;
    const localToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    process.env[tokenName] = localToken;
    tokenEnvNames.push(tokenName);
    const system = await registerSystem(
      { sub: admin.id, role: 'platform_admin' },
      { system_key: systemKey, name: 'Synthetic Hospital A EHR', identifier: `urn:synthetic:${systemKey}`, facility_id: facility.id, supported_types: ['Patient', 'Observation'] },
      meta,
    );
    cleanup.externalSystemId = system.id;
    assert.equal(system.status, 'pending');
    await activateSystem(system.id, { sub: admin.id, role: 'platform_admin' }, meta);
    const authenticated = await authenticateIntegration(systemKey, `Bearer ${localToken}`);
    assert.equal(authenticated.id, system.id);
    await assert.rejects(() => authenticateIntegration(systemKey, 'Bearer invalid-test-credential'));

    const patientResource = {
      resourceType: 'Patient', id: 'patient-a', meta: { versionId: '1', lastUpdated: '2026-10-01T08:00:00Z' },
      identifier: [{ system: `urn:synthetic:${systemKey}`, value: 'TEST-PATIENT-A' }], active: true,
      name: [{ text: 'Synthetic Patient A — NOT REAL' }], gender: 'unknown', birthDate: '2000-01-01',
    };
    const importedPatient = await importFhirResource(authenticated, patientResource, meta);
    assert.equal(importedPatient.validation_status, 'quarantined');
    const patientIdentity = await prisma.externalPatientIdentity.findUniqueOrThrow({
      where: { externalSystemId_externalPatientId: { externalSystemId: system.id, externalPatientId: 'patient-a' } },
    });
    const adminCaller = { sub: admin.id, role: 'platform_admin' };
    await confirmIdentity(patientIdentity.id, adminCaller, {
      patient_profile_id: patientA.id, evidence_reference: 'SYNTH-VERIFY-001',
    }, meta);

    const firstVersion = observation('1', '2026-10-01T09:00:00Z', '2026-10-01T08:55:00Z', 'patient-a');
    const concurrent = await Promise.all([
      importFhirResource(authenticated, firstVersion, meta),
      importFhirResource(authenticated, firstVersion, meta),
    ]);
    assert.equal(concurrent[0]!.id, concurrent[1]!.id);
    assert.equal(concurrent.filter((result) => result.duplicate).length, 1);
    const firstResourceId = concurrent[0]!.id;
    assert.equal(concurrent[0]!.validation_status, 'accepted');

    await importFhirResource(authenticated, {
      resourceType: 'Patient', id: 'patient-privacy', meta: { versionId: '1', lastUpdated: '2026-10-01T08:01:00Z' },
      active: true, name: [{ text: 'Synthetic privacy candidate - NOT REAL' }], gender: 'unknown', birthDate: '1990-01-01',
    }, meta);
    const pending = await listPendingIdentities();
    const pendingIdentity = pending.data.find((row) => row.source_system.system_key === systemKey);
    assert.ok(pendingIdentity);
    assert.equal('external_patient_id' in pendingIdentity, false);
    assert.equal('patient_name' in pendingIdentity, false);
    const patientTimeline = await getMyTimeline({ sub: patientAUser.id, role: 'patient', ppid: patientA.id }, {}, meta);
    assert.ok(patientTimeline.data.some((entry) => entry.id === firstResourceId));
    assert.ok(patientTimeline.data.some((entry) => entry.id === nativeRecord.id));
    assert.ok(patientTimeline.data.every((entry) => entry.source.type === 'ahp' || entry.source.type === 'external'));
    const patientBTimeline = await getMyTimeline({ sub: patientBUser.id, role: 'patient', ppid: patientB.id }, {}, meta);
    assert.equal(patientBTimeline.data.some((entry) => entry.id === firstResourceId), false);
    await assert.rejects(
      () => getExternalRecordDetail(firstResourceId, { sub: patientBUser.id, role: 'patient', ppid: patientB.id }, meta),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER',
    );

    const authorizedClinician = await getPatientTimeline(patientA.id, { sub: clinicianAUser.id, role: 'clinician', cpid: clinicianA.id }, {}, meta);
    assert.ok(authorizedClinician.data.some((entry) => entry.id === firstResourceId));
    await assert.rejects(
      () => getPatientTimeline(patientA.id, { sub: clinicianBUser.id, role: 'clinician', cpid: clinicianB.id }, {}, meta),
      (error: AppError) => error.code === 'PATIENT_CONSENT_REQUIRED',
    );

    const secondVersion = observation('2', '2026-10-01T10:00:00Z', '2026-10-01T09:55:00Z', 'patient-a');
    const importedSecondVersion = await importFhirResource(authenticated, secondVersion, meta);
    assert.notEqual(importedSecondVersion.id, firstResourceId);
    assert.equal(importedSecondVersion.validation_status, 'accepted');
    await assert.rejects(() => importFhirResource(
      authenticated, observation('0', '2026-09-30T09:00:00Z', '2026-09-30T08:55:00Z', 'patient-a'), meta,
    ));

    const ambiguous = await markIdentityAmbiguous(patientIdentity.id, adminCaller, {
      candidate_patient_profile_ids: [patientA.id, patientB.id], evidence_reference: 'SYNTH-AMBIGUOUS-A1',
    }, meta);
    assert.equal(ambiguous.status, 'ambiguous');
    let patientTimelineAfterAmbiguous = await getMyTimeline({ sub: patientAUser.id, role: 'patient', ppid: patientA.id }, {}, meta);
    assert.ok(patientTimelineAfterAmbiguous.data.some((entry) => entry.id === nativeRecord.id));
    assert.equal(patientTimelineAfterAmbiguous.data.some((entry) => entry.id === firstResourceId), false);
    assert.equal(patientTimelineAfterAmbiguous.data.some((entry) => entry.id === importedSecondVersion.id), false);
    await assert.rejects(() => getExternalRecordDetail(firstResourceId, { sub: patientAUser.id, role: 'patient', ppid: patientA.id }, meta));
    const hiddenRows = await prisma.externalFhirResource.findMany({ where: { identityId: patientIdentity.id } });
    assert.ok(hiddenRows.every((row) => row.patientProfileId === null && row.validationStatus === 'quarantined'));

    await confirmIdentity(patientIdentity.id, adminCaller, {
      patient_profile_id: patientA.id, evidence_reference: 'SYNTH-RECONFIRM-A1',
    }, meta);
    const restoredTimeline = await getMyTimeline({ sub: patientAUser.id, role: 'patient', ppid: patientA.id }, {}, meta);
    assert.ok(restoredTimeline.data.some((entry) => entry.id === firstResourceId));

    const rejected = await rejectIdentity(patientIdentity.id, adminCaller, { evidence_reference: 'SYNTH-REJECT-A1' }, meta);
    assert.equal(rejected.status, 'rejected');
    patientTimelineAfterAmbiguous = await getMyTimeline({ sub: patientAUser.id, role: 'patient', ppid: patientA.id }, {}, meta);
    assert.ok(patientTimelineAfterAmbiguous.data.some((entry) => entry.id === nativeRecord.id));
    assert.equal(patientTimelineAfterAmbiguous.data.some((entry) => entry.id === firstResourceId), false);
    const rejectedRows = await prisma.externalFhirResource.findMany({ where: { identityId: patientIdentity.id } });
    assert.ok(rejectedRows.every((row) => row.patientProfileId === null && row.validationStatus === 'quarantined'));

    const createIdentity = async (externalPatientId: string) => {
      await importFhirResource(authenticated, {
        resourceType: 'Patient', id: externalPatientId,
        meta: { versionId: '1', lastUpdated: '2026-10-02T08:00:00Z' },
        active: true, name: [{ text: 'Synthetic concurrency actor - NOT REAL' }],
      }, meta);
      return prisma.externalPatientIdentity.findUniqueOrThrow({
        where: { externalSystemId_externalPatientId: { externalSystemId: system.id, externalPatientId } },
      });
    };

    const raceIdentity = await createIdentity('patient-race-confirm-ambiguous');
    await confirmIdentity(raceIdentity.id, adminCaller, { patient_profile_id: patientB.id, evidence_reference: 'SYNTH-RACE-SETUP-1' }, meta);
    const raceImported = await importFhirResource(authenticated,
      observation('1', '2026-10-02T09:00:00Z', '2026-10-02T08:55:00Z', 'patient-race-confirm-ambiguous', 'observation-race-confirm-ambiguous'), meta);
    const raceStart = startBarrier(3);
    const raceResults = await Promise.all([
      (async () => { await raceStart(); return confirmIdentity(raceIdentity.id, adminCaller, { patient_profile_id: patientB.id, evidence_reference: 'SYNTH-RACE-CONFIRM-1' }, meta); })(),
      (async () => { await raceStart(); return markIdentityAmbiguous(raceIdentity.id, adminCaller, { candidate_patient_profile_ids: [patientA.id, patientB.id], evidence_reference: 'SYNTH-RACE-AMBIGUOUS-1' }, meta); })(),
      (async () => { await raceStart(); return getMyTimeline({ sub: patientAUser.id, role: 'patient', ppid: patientA.id }, {}, meta); })(),
    ]);
    assert.equal(raceResults.length, 3);
    assert.equal(raceResults[2]!.data.some((entry) => entry.id === raceImported.id), false);
    const raceState = await prisma.externalPatientIdentity.findUniqueOrThrow({ where: { id: raceIdentity.id } });
    const raceRows = await prisma.externalFhirResource.findMany({ where: { identityId: raceIdentity.id } });
    assert.ok(raceState.status === 'confirmed' || raceState.status === 'ambiguous');
    if (raceState.status === 'confirmed') {
      assert.equal(raceState.patientProfileId, patientB.id);
      assert.ok(raceRows.every((row) => row.patientProfileId === patientB.id && row.validationStatus === 'accepted'));
    } else {
      assert.equal(raceState.patientProfileId, null);
      assert.ok(raceRows.every((row) => row.patientProfileId === null && row.validationStatus === 'quarantined'));
    }
    const racePatientATimeline = await getMyTimeline({ sub: patientAUser.id, role: 'patient', ppid: patientA.id }, {}, meta);
    assert.equal(racePatientATimeline.data.some((entry) => entry.id === raceImported.id), false);
    const racePatientBTimeline = await getMyTimeline({ sub: patientBUser.id, role: 'patient', ppid: patientB.id }, {}, meta);
    assert.equal(racePatientBTimeline.data.some((entry) => entry.id === raceImported.id), raceState.status === 'confirmed');

    const reconcileRaceIdentity = await createIdentity('patient-race-reconcile-import');
    const reconcileStart = startBarrier(2);
    const reconcileRace = await Promise.all([
      (async () => { await reconcileStart(); return confirmIdentity(reconcileRaceIdentity.id, adminCaller, { patient_profile_id: patientA.id, evidence_reference: 'SYNTH-RACE-RECONCILE-1' }, meta); })(),
      (async () => { await reconcileStart(); return importFhirResource(authenticated,
        observation('1', '2026-10-03T09:00:00Z', '2026-10-03T08:55:00Z', 'patient-race-reconcile-import', 'observation-race-reconcile-import'), meta); })(),
    ]);
    const reconcileRaceState = await prisma.externalPatientIdentity.findUniqueOrThrow({ where: { id: reconcileRaceIdentity.id } });
    const reconcileRaceRecord = await prisma.externalFhirResource.findUniqueOrThrow({ where: { id: reconcileRace[1]!.id } });
    assert.equal(reconcileRaceState.status, 'confirmed');
    assert.equal(reconcileRaceRecord.patientProfileId, patientA.id);
    assert.equal(reconcileRaceRecord.validationStatus, 'accepted');
    const reconciledTimeline = await getMyTimeline({ sub: patientAUser.id, role: 'patient', ppid: patientA.id }, {}, meta);
    assert.ok(reconciledTimeline.data.some((entry) => entry.id === reconcileRaceRecord.id));

    const rejectRaceIdentity = await createIdentity('patient-race-reject-import');
    const rejectStart = startBarrier(2);
    const rejectRace = await Promise.all([
      (async () => { await rejectStart(); return rejectIdentity(rejectRaceIdentity.id, adminCaller, { evidence_reference: 'SYNTH-RACE-REJECT-1' }, meta); })(),
      (async () => { await rejectStart(); return importFhirResource(authenticated,
        observation('1', '2026-10-04T09:00:00Z', '2026-10-04T08:55:00Z', 'patient-race-reject-import', 'observation-race-reject-import'), meta); })(),
    ]);
    assert.equal(rejectRace[0]!.status, 'rejected');
    const rejectRaceState = await prisma.externalPatientIdentity.findUniqueOrThrow({ where: { id: rejectRaceIdentity.id } });
    const rejectRaceRecord = await prisma.externalFhirResource.findUniqueOrThrow({ where: { id: rejectRace[1]!.id } });
    assert.equal(rejectRaceState.status, 'rejected');
    assert.equal(rejectRaceRecord.patientProfileId, null);
    assert.equal(rejectRaceRecord.validationStatus, 'quarantined');
    const noRejectedTimeline = await getMyTimeline({ sub: patientAUser.id, role: 'patient', ppid: patientA.id }, {}, meta);
    assert.equal(noRejectedTimeline.data.some((entry) => entry.id === rejectRaceRecord.id), false);
    const rejectedPatientBTimeline = await getMyTimeline({ sub: patientBUser.id, role: 'patient', ppid: patientB.id }, {}, meta);
    assert.equal(rejectedPatientBTimeline.data.some((entry) => entry.id === rejectRaceRecord.id), false);

    const invalidAuditMeta = { ...meta, requestId: 'x'.repeat(65) };
    await assert.rejects(() => markIdentityAmbiguous(reconcileRaceIdentity.id, adminCaller, {
      candidate_patient_profile_ids: [patientA.id, patientB.id], evidence_reference: 'SYNTH-ROLLBACK-1',
    }, invalidAuditMeta));
    const rollbackIdentity = await prisma.externalPatientIdentity.findUniqueOrThrow({ where: { id: reconcileRaceIdentity.id } });
    const rollbackRecord = await prisma.externalFhirResource.findUniqueOrThrow({ where: { id: reconcileRaceRecord.id } });
    assert.equal(rollbackIdentity.status, 'confirmed');
    assert.equal(rollbackIdentity.patientProfileId, patientA.id);
    assert.equal(rollbackRecord.patientProfileId, patientA.id);
    assert.equal(rollbackRecord.validationStatus, 'accepted');

    await assert.rejects(
      () => getPatientTimeline(patientA.id, { sub: clinicianBUser.id, role: 'clinician', cpid: clinicianB.id }, {}, meta),
      (error: AppError) => error.code === 'PATIENT_CONSENT_REQUIRED',
    );

    await prisma.patientConsent.update({ where: { id: consent.id }, data: { allowed: false, revokedAt: new Date() } });
    await assert.rejects(
      () => getPatientTimeline(patientA.id, { sub: clinicianAUser.id, role: 'clinician', cpid: clinicianA.id }, {}, meta),
      (error: AppError) => error.code === 'PATIENT_CONSENT_REQUIRED',
    );
    const ledger = await verifyAuditChain();
    assert.equal(ledger.ok, true);
  });
});
