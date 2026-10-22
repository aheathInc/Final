import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('devices.telemetry');

/**
 * Batched because a watch on a patchy network buffers for hours. Each
 * reading carries its own device-clock timestamp — arrival order at this
 * endpoint means nothing, and is never used to order the stored rows.
 */
export async function ingestTelemetry(
  deviceId: string,
  readings: { metric: string; value: number; unit?: string | null; recorded_at: string }[],
) {
  await prisma.$transaction([
    prisma.deviceTelemetry.createMany({
      data: readings.map((r) => ({
        deviceId, metric: r.metric as never, value: r.value,
        unit: r.unit ?? null, recordedAt: new Date(r.recorded_at),
      })),
    }),
    prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } }),
  ]);
}

const RECIPIENT_RESOLVERS: Record<string, (patientProfileId: string) => Promise<{ type: string; id: string | null }[]>> = {
  async patient(patientProfileId) {
    const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!patient) return [];
    const ids = [patient.userId, patient.guardianUserId].filter((x): x is string => Boolean(x));
    return ids.map((id) => ({ type: 'patient', id }));
  },
  async treating_clinician(patientProfileId) {
    const thread = await prisma.careThread.findFirst({
      where: { patientProfileId, status: 'open' },
      orderBy: { updatedAt: 'desc' },
      include: { consultations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const clinicianId = thread?.consultations[0]?.assignedClinicianId ?? thread?.primaryClinicianId ?? null;
    return clinicianId ? [{ type: 'treating_clinician', id: clinicianId }] : [];
  },
  async family_doctor(patientProfileId) {
    const family = await prisma.familyMember.findFirst({
      where: { patientProfileId },
      include: { family: { include: { assignments: true } } },
    });
    const gp = family?.family.assignments[0]?.gpClinicianId ?? null;
    return gp ? [{ type: 'family_doctor', id: gp }] : [];
  },
};

/**
 * Fans out to whichever recipients can actually be resolved from real data
 * — the patient themselves, their treating clinician, their family doctor —
 * and opens a REAL emergency through services/emergency's own endpoint,
 * reusing the bystander-reporting path already built there rather than a
 * second implementation. A device with nobody nearby to speak for the
 * patient is structurally the same situation a bystander call already
 * handles, down to the optional-auth requirement.
 *
 * Recipient rows are written as delivered:false — actual dispatch through
 * the notification service is a follow-up wiring step, noted here rather
 * than silently assumed.
 */
export async function raiseDeviceAlert(
  deviceId: string,
  input: { alert_type: string; detected_at: string; location?: { lat: number; lng: number }; confidence?: number; readings?: unknown[] },
) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return null;

  const alert = await prisma.deviceAlert.create({
    data: {
      deviceId,
      alertType: input.alert_type as never,
      confidence: input.confidence ?? null,
      lat: input.location?.lat ?? null,
      lng: input.location?.lng ?? null,
      triggerReadings: (input.readings ?? []) as never,
      detectedAt: new Date(input.detected_at),
    },
  });

  if (device.patientProfileId) {
    for (const [type, resolver] of Object.entries(RECIPIENT_RESOLVERS)) {
      const recipients = await resolver(device.patientProfileId);
      for (const r of recipients) {
        await prisma.deviceAlertRecipient.create({
          data: { alertId: alert.id, recipientType: r.type as never, recipientId: r.id, channel: 'app' as never },
        });
      }
    }
  }

  try {
    const source = device.deviceType === 'vehicle_sensor' ? 'vehicle_sensor' : 'wearable';
    const response = await fetch(`${env.EMERGENCY_SERVICE_URL}/emergency-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `alert-${alert.id}` },
      body: JSON.stringify({
        scale: 'individual',
        category: input.alert_type === 'collision_detected' ? 'road_traffic' : 'medical',
        location: input.location ?? { lat: 0, lng: 0 },
        patient_profile_id: device.patientProfileId ?? undefined,
        source,
        description: `Device alert: ${input.alert_type}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const body = (await response.json()) as { id: string };
      await prisma.deviceAlert.update({ where: { id: alert.id }, data: { emergencyRequestId: body.id } });
    }
  } catch (err) {
    logger.error('failed to open emergency from device alert', { alertId: alert.id, err: String(err) });
  }

  return alert;
}
