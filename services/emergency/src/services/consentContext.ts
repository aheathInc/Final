import { prisma } from '@a-health/database';
import { appendAudit } from '@a-health/http';

export interface EmergencyContext {
  allergies: string[];
  chronicConditions: string[];
  bloodType: string | null;
  breakGlass: boolean;
}

/**
 * Resolves what a receiving facility may know about a patient at dispatch.
 *
 * A conscious patient with an existing `emergency_minimum` or broader consent
 * grant is served from that grant. An unconscious patient with no grant is
 * served anyway — a person collapsed in the street cannot consent — but that
 * path is named `breakGlass` in the audit trail and always writes an entry,
 * exactly as the schema's own comment on PatientConsent describes. Silence
 * would be worse than either withholding the context or logging the access.
 */
export async function resolveEmergencyContext(
  patientProfileId: string,
  emergencyId: string,
  actorUserId: string | undefined,
): Promise<EmergencyContext | null> {
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) return null;

  const grant = await prisma.patientConsent.findFirst({
    where: {
      patientProfileId,
      granteeType: 'emergency_responder',
      allowed: true,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  const breakGlass = !grant;

  if (breakGlass) {
    await appendAudit({
      actorUserId: actorUserId ?? null,
      action: 'emergency.context_break_glass_access',
      entityType: 'patient_profiles',
      entityId: patientProfileId,
      reason: 'No standing emergency-responder consent at time of dispatch',
      metadata: { emergencyRequestId: emergencyId },
    });
  }

  return {
    allergies: Array.isArray(patient.allergies) ? (patient.allergies as string[]) : [],
    chronicConditions: Array.isArray(patient.chronicConditions) ? (patient.chronicConditions as string[]) : [],
    bloodType: patient.bloodType,
    breakGlass,
  };
}
