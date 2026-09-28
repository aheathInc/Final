import { prisma } from '@a-health/database';
import { appendAudit, forbidden, notFound } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(v: {
  id: string; vaccineCode: string; doseNumber: number; status: string;
  dueAt: Date | null; administeredAt: Date | null; facilityId: string | null; batchNumber: string | null;
}) {
  return {
    id: v.id,
    vaccine_code: v.vaccineCode,
    dose_number: v.doseNumber,
    status: v.status,
    due_at: v.dueAt?.toISOString() ?? null,
    administered_at: v.administeredAt?.toISOString() ?? null,
    facility_id: v.facilityId,
    batch_number: v.batchNumber,
  };
}

async function assertVisible(patientProfileId: string, caller: Caller) {
  if (caller.role === 'platform_admin' || caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');
  if (patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view vaccination records for this patient');
  }
}

export async function listVaccinations(patientProfileId: string, caller: Caller) {
  await assertVisible(patientProfileId, caller);
  const rows = await prisma.vaccination.findMany({ where: { patientProfileId }, orderBy: { doseNumber: 'asc' } });
  return { data: rows.map(serialise) };
}

/** Clinician or admin only — recording a dose is a clinical act, not a self-report. */
export async function recordVaccination(
  patientProfileId: string, caller: Caller,
  input: { vaccine_code: string; administered_at: string; dose_number?: number; facility_id?: string; batch_number?: string },
  meta: Meta,
) {
  if (!caller.cpid && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a clinician or admin may record a dose');
  }
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');

  const dose = await prisma.vaccination.create({
    data: {
      patientProfileId, vaccineCode: input.vaccine_code, doseNumber: input.dose_number ?? 1,
      status: 'administered', administeredAt: new Date(input.administered_at),
      facilityId: input.facility_id ?? null, batchNumber: input.batch_number ?? null,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'prevention.vaccination_recorded',
    entityType: 'vaccinations', entityId: dose.id,
    metadata: { vaccineCode: input.vaccine_code, patientProfileId },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(dose);
}
