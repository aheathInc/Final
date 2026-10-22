import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { sha256 } from '@a-health/http';
import * as devices from '../services/device.service.js';
import { ingestTelemetry, raiseDeviceAlert } from '../services/telemetry.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const deviceIds: string[] = [];

after(async () => {
  for (const id of deviceIds) {
    await prisma.deviceAlertRecipient.deleteMany({ where: { alert: { deviceId: id } } }).catch(() => undefined);
    await prisma.deviceAlert.deleteMany({ where: { deviceId: id } }).catch(() => undefined);
    await prisma.deviceTelemetry.deleteMany({ where: { deviceId: id } }).catch(() => undefined);
    await prisma.device.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Device Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Device Test' } });
  return { user, profile };
}

describe('registration', () => {
  it('registers a wearable and returns the credential once', async () => {
    const { user, profile } = await makePatient();
    const result = await devices.registerDevice(
      { sub: user.id, role: 'patient', ppid: profile.id },
      { device_type: 'wearable_watch', serial_number: `SN-${randomUUID()}` }, meta,
    );
    deviceIds.push(result.id);
    assert.ok(result.device_credential);

    const row = await prisma.device.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(row.credentialHash, sha256(result.device_credential));
  });

  it('refuses a duplicate serial number', async () => {
    const { user, profile } = await makePatient();
    const serial = `SN-${randomUUID()}`;
    const first = await devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: serial }, meta);
    deviceIds.push(first.id);

    await assert.rejects(
      () => devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: serial }, meta),
    );
  });

  it('registers a vehicle sensor with no patient profile', async () => {
    const { user } = await makePatient();
    const result = await devices.registerDevice(
      { sub: user.id, role: 'platform_admin' },
      { device_type: 'vehicle_sensor', serial_number: `SN-${randomUUID()}`, vehicle_registration: 'T123ABC' }, meta,
    );
    deviceIds.push(result.id);
    assert.equal(result.patient_profile_id, null);
  });
});

describe('revocation', () => {
  it('is idempotent — revoking twice does not error', async () => {
    const { user, profile } = await makePatient();
    const result = await devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: `SN-${randomUUID()}` }, meta);
    deviceIds.push(result.id);

    await devices.revokeDevice(result.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    await devices.revokeDevice(result.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);

    const row = await prisma.device.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(row.status, 'revoked');
  });
});

describe('telemetry', () => {
  it('ingests a batch and updates last_seen_at', async () => {
    const { user, profile } = await makePatient();
    const result = await devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: `SN-${randomUUID()}` }, meta);
    deviceIds.push(result.id);

    await ingestTelemetry(result.id, [
      { metric: 'heart_rate', value: 72, recorded_at: new Date().toISOString() },
      { metric: 'spo2', value: 98, recorded_at: new Date().toISOString() },
    ]);

    const count = await prisma.deviceTelemetry.count({ where: { deviceId: result.id } });
    assert.equal(count, 2);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: result.id } });
    assert.ok(row.lastSeenAt);
  });
});

describe('alerts', () => {
  it('raises an alert and resolves the patient as a recipient', async () => {
    const { user, profile } = await makePatient();
    const result = await devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: `SN-${randomUUID()}` }, meta);
    deviceIds.push(result.id);

    const alert = await raiseDeviceAlert(result.id, { alert_type: 'fall_detected', detected_at: new Date().toISOString() });
    assert.ok(alert);

    const recipients = await prisma.deviceAlertRecipient.findMany({ where: { alertId: alert!.id } });
    assert.ok(recipients.some((r) => r.recipientType === 'patient' && r.recipientId === user.id));
  });
});
