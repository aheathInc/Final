import { randomBytes } from 'node:crypto';
import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, sha256 } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(d: {
  id: string; deviceType: string; serialNumber: string; patientProfileId: string | null;
  vehicleRegistration: string | null; label: string | null; status: string;
  lastSeenAt: Date | null; batteryPercent: number | null; version: number;
}) {
  return {
    id: d.id,
    device_type: d.deviceType,
    serial_number: d.serialNumber,
    patient_profile_id: d.patientProfileId,
    vehicle_registration: d.vehicleRegistration,
    label: d.label,
    status: d.status,
    last_seen_at: d.lastSeenAt?.toISOString() ?? null,
    battery_percent: d.batteryPercent,
    version: d.version,
  };
}

/**
 * The device credential is generated here, shown once in the response, and
 * never retrievable again — a secret that can raise an emergency is not one
 * worth keeping recoverable. Losing it means re-registering, which is the
 * correct trade.
 */
export async function registerDevice(
  caller: Caller,
  input: {
    device_type: string; serial_number: string; patient_profile_id?: string;
    vehicle_registration?: string; label?: string;
  },
  meta: Meta,
) {
  const isVehicle = input.device_type === 'vehicle_sensor';
  const patientProfileId = isVehicle ? null : (input.patient_profile_id ?? caller.ppid ?? null);
  if (!isVehicle && !patientProfileId) {
    throw forbidden('ROLE_NOT_PERMITTED', 'A patient-worn device needs a patient profile');
  }

  const existing = await prisma.device.findUnique({ where: { serialNumber: input.serial_number } });
  if (existing) throw conflict('DUPLICATE_RESOURCE', 'A device with this serial number is already registered');

  const credential = randomBytes(32).toString('hex');

  const device = await prisma.device.create({
    data: {
      deviceType: input.device_type as never,
      serialNumber: input.serial_number,
      patientProfileId,
      vehicleRegistration: isVehicle ? (input.vehicle_registration ?? null) : null,
      label: input.label ?? null,
      credentialHash: sha256(credential),
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'device.registered',
    entityType: 'devices', entityId: device.id,
    metadata: { deviceType: input.device_type },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return { ...serialise(device), device_credential: credential };
}

export async function listDevices(caller: Caller) {
  const where = caller.role === 'platform_admin' ? {} : { patientProfileId: caller.ppid ?? '__none__' };
  const rows = await prisma.device.findMany({ where, orderBy: { createdAt: 'desc' } });
  return { data: rows.map(serialise) };
}

/** Idempotent: revoking an already-revoked device is not an error — the end state is what the caller wants, and they may not know which state it was already in. */
export async function revokeDevice(deviceId: string, caller: Caller, meta: Meta) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw notFound('Device not found');

  const owns = caller.role === 'platform_admin' || (device.patientProfileId && device.patientProfileId === caller.ppid);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'You cannot revoke this device');

  if (device.status !== 'revoked') {
    await prisma.device.update({
      where: { id: deviceId },
      data: { status: 'revoked', revokedAt: new Date(), version: { increment: 1 } },
    });
    await appendAudit({
      actorUserId: caller.sub, action: 'device.revoked',
      entityType: 'devices', entityId: deviceId,
      ipAddress: meta.ip, requestId: meta.requestId,
    });
  }
}
