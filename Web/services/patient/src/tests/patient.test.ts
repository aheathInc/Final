import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { appendAudit } from '@a-health/http';
import type { AppError } from '@a-health/http';
import * as profiles from '../services/profile.service.js';
import * as consents from '../services/consent.service.js';
import { grantConsentSchema } from '../types/patient.types.js';

let testDatabase: URL;
try {
  testDatabase = new URL(process.env.DATABASE_URL ?? '');
} catch {
  throw new Error('Refusing patient tests without a valid local ahealth_test DATABASE_URL.');
}
if (
  decodeURIComponent(testDatabase.pathname.replace(/^\//, '')) !== 'ahealth_test' ||
  !['localhost', '127.0.0.1', '::1'].includes(testDatabase.hostname) ||
  (testDatabase.port || '5432') === '5432'
) {
  throw new Error('Refusing patient tests unless DATABASE_URL targets local ahealth_test on a non-5432 port.');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const createdUsers: string[] = [];
const createdProfiles: string[] = [];
const createdClinicians: string[] = [];

after(async () => {
  for (const id of createdProfiles) {
    await prisma.patientConsent.deleteMany({ where: { patientProfileId: id } }).catch(() => undefined);
    await prisma.changeLog.deleteMany({ where: { patientProfileId: id } }).catch(() => undefined);
    await prisma.patientProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdClinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdUsers) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeGuardian() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: 'patient', status: 'active', fullName: 'Guardian Test',
    },
  });
  createdUsers.push(user.id);
  const profile = await prisma.patientProfile.create({
    data: { userId: user.id, fullName: 'Guardian Test' },
  });
  createdProfiles.push(profile.id);
  return { user, profile };
}

/** A real, minimally verified clinician — grantee_clinician_id is a foreign key, not a free-text field. */
async function makeClinician() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: `${randomUUID()}@test.local`,
      role: 'clinician', status: 'active', fullName: 'Consent Test Clinician',
    },
  });
  createdUsers.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: {
      userId: user.id,
      licenseNumber: `TEST-${randomUUID().slice(0, 12)}`,
      specialty: 'general_practice',
      verificationStatus: 'verified',
    },
  });
  createdClinicians.push(profile.id);
  return profile;
}

describe('profile ownership', () => {
  it('lets the owner read their own profile', async () => {
    const { user, profile } = await makeGuardian();
    const result = await profiles.getProfile(profile.id, { sub: user.id, role: 'patient' });
    assert.equal(result.id, profile.id);
  });

  it('refuses a stranger', async () => {
    const { profile } = await makeGuardian();
    await assert.rejects(
      () => profiles.getProfile(profile.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('rejects a stale base_version', async () => {
    const { user, profile } = await makeGuardian();
    await assert.rejects(
      () => profiles.updateProfile(profile.id, { sub: user.id, role: 'patient' }, {
        base_version: profile.version - 1, full_name: 'Stale Name',
      }),
      (e: AppError) => e.code === 'VERSION_CONFLICT',
    );
  });

  it('increments version and records the change', async () => {
    const { user, profile } = await makeGuardian();
    const updated = await profiles.updateProfile(profile.id, { sub: user.id, role: 'patient' }, {
      base_version: profile.version, full_name: 'Renamed',
    });
    assert.equal(updated.version, profile.version + 1);

    const changes = await prisma.changeLog.count({ where: { patientProfileId: profile.id, op: 'update' } });
    assert.ok(changes >= 1);
  });
});

describe('dependants', () => {
  it('creates a dependant with no login of their own', async () => {
    const { user } = await makeGuardian();
    const dependent = await profiles.createDependent(user.id, {
      full_name: 'Baby Test', date_of_birth: '2024-01-01', sex: 'female',
    }, meta);
    createdProfiles.push(dependent.id);

    assert.equal(dependent.guardian_user_id, user.id);
    assert.equal(dependent.user_id, null);
  });

  it('lists only this guardian\'s dependants', async () => {
    const { user } = await makeGuardian();
    const other = await makeGuardian();

    const mine = await profiles.createDependent(user.id, {
      full_name: 'Mine', date_of_birth: '2020-01-01', sex: 'male',
    }, meta);
    createdProfiles.push(mine.id);
    const theirs = await profiles.createDependent(other.user.id, {
      full_name: 'Theirs', date_of_birth: '2020-01-01', sex: 'male',
    }, meta);
    createdProfiles.push(theirs.id);

    const result = await profiles.listDependents(user.id, { limit: 25 });
    assert.ok(result.data.some((d) => d.id === mine.id));
    assert.ok(!result.data.some((d) => d.id === theirs.id));
  });

  it('caps dependants per guardian', async () => {
    const { user } = await makeGuardian();
    for (let i = 0; i < 12; i += 1) {
      const d = await profiles.createDependent(user.id, {
        full_name: `Child ${i}`, date_of_birth: '2020-01-01', sex: 'male',
      }, meta);
      createdProfiles.push(d.id);
    }
    await assert.rejects(
      () => profiles.createDependent(user.id, {
        full_name: 'One Too Many', date_of_birth: '2020-01-01', sex: 'male',
      }, meta),
      (e: AppError) => e.code === 'DUPLICATE_RESOURCE',
    );
  });
});

describe('consent', () => {
  it('grants and lists a consent', async () => {
    const { user, profile } = await makeGuardian();
    const clinician = await makeClinician();
    await consents.grantConsent(profile.id, { sub: user.id, role: 'patient' }, {
      grantee_type: 'clinician',
      grantee_clinician_id: clinician.id,
      scope: 'current_thread',
    }, meta);

    const list = await consents.listConsents(profile.id, { sub: user.id, role: 'patient' });
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0]!.scope, 'current_thread');

    const history = await consents.listOwnAuditHistory(profile.id, { sub: user.id, role: 'patient' });
    assert.equal(history.data[0]!.event_type, 'consent.granted');
    assert.equal(history.data[0]!.scope, 'current_thread');
    assert.equal('actor_id' in history.data[0]!, false);
    assert.equal('hash' in history.data[0]!, false);
  });

  it('revoke marks disallowed rather than deleting the record', async () => {
    const { user, profile } = await makeGuardian();
    const granted = await consents.grantConsent(profile.id, { sub: user.id, role: 'patient' }, {
      grantee_type: 'researcher', scope: 'investigations_only',
    }, meta);

    const revoked = await consents.revokeConsent(profile.id, granted.id, { sub: user.id, role: 'patient' }, meta);
    assert.equal(revoked.allowed, false);
    assert.ok(revoked.revoked_at);

    const refreshedList = await consents.listConsents(profile.id, { sub: user.id, role: 'patient' });
    const persistedRevocation = refreshedList.data.find((row) => row.id === granted.id);
    assert.ok(persistedRevocation);
    assert.equal(persistedRevocation.allowed, false);
    assert.ok(persistedRevocation.revoked_at);

    // Revoked, not deleted — the row itself is part of the accountability trail.
    const stillExists = await prisma.patientConsent.findUnique({ where: { id: granted.id } });
    assert.ok(stillExists);

    const history = await consents.listOwnAuditHistory(profile.id, { sub: user.id, role: 'patient' });
    assert.ok(history.data.some((row) => row.event_type === 'consent.granted'));
    assert.ok(history.data.some((row) => row.event_type === 'consent.revoked'));
  });

  it('a stranger cannot grant consent on someone else\'s profile', async () => {
    const { profile } = await makeGuardian();
    await assert.rejects(
      () => consents.grantConsent(profile.id, { sub: randomUUID(), role: 'patient' }, {
        grantee_type: 'clinician', scope: 'full_history',
      }, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('a stranger cannot list or revoke another patient\'s consent', async () => {
    const { user, profile } = await makeGuardian();
    const consent = await consents.grantConsent(profile.id, { sub: user.id, role: 'patient' }, {
      grantee_type: 'researcher', scope: 'investigations_only',
    }, meta);
    const stranger = { sub: randomUUID(), role: 'patient' };

    await assert.rejects(
      () => consents.listConsents(profile.id, stranger),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
    await assert.rejects(
      () => consents.listOwnAuditHistory(profile.id, stranger),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
    await assert.rejects(
      () => consents.revokeConsent(profile.id, consent.id, stranger, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('rejects consent scopes outside the supported contract', () => {
    assert.equal(grantConsentSchema.safeParse({
      grantee_type: 'researcher',
      scope: 'all_records_forever',
    }).success, false);
  });

  it('rolls back a grant when the ledger append fails', async () => {
    const { user, profile } = await makeGuardian();
    const triggerName = 'test_reject_audit_insert_trigger';
    const functionName = 'test_reject_audit_insert';
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "audit_logs"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit insert failure'; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );

    try {
      await assert.rejects(() => consents.grantConsent(
        profile.id,
        { sub: user.id, role: 'patient' },
        { grantee_type: 'researcher', scope: 'investigations_only' },
        meta,
      ));
      assert.equal(await prisma.patientConsent.count({ where: { patientProfileId: profile.id } }), 0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "audit_logs"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  });

  it('projects break-glass events without internal ledger fields', async () => {
    const { user, profile } = await makeGuardian();
    await appendAudit({
      actorUserId: user.id,
      action: 'emergency.context_break_glass_access',
      entityType: 'patient_profiles',
      entityId: profile.id,
      reason: 'Synthetic emergency access',
      metadata: { emergencyRequestId: randomUUID() },
      ipAddress: '127.0.0.1',
      requestId: randomUUID(),
    });

    const history = await consents.listOwnAuditHistory(profile.id, { sub: user.id, role: 'patient' });
    assert.equal(history.data[0]!.event_type, 'emergency.context_break_glass_access');
    assert.equal('actor_id' in history.data[0]!, false);
    assert.equal('reason' in history.data[0]!, false);
    assert.equal('request_id' in history.data[0]!, false);
  });
});
