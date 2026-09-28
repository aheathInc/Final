import { prisma } from '@a-health/database';

/**
 * Fetches the current live snapshot of one changed row, for exactly the
 * entities this service knows how to serialise. Deliberately not generic:
 * covering all seventeen SyncEntity values honestly, one real fetcher at a
 * time, matches how research and surveillance were scoped — a documented,
 * incremental subset rather than a claim of full coverage that isn't there.
 * An entity with no fetcher here is simply omitted from a sync response,
 * not silently faked.
 */
export type EntityFetcher = (id: string) => Promise<Record<string, unknown> | null>;

export const ENTITY_FETCHERS: Partial<Record<string, EntityFetcher>> = {
  care_threads: async (id) => {
    const row = await prisma.careThread.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, patient_profile_id: row.patientProfileId, status: row.status,
      reason_summary: row.reasonSummary, latest_consultation_id: row.latestConsultationId,
      open_consultation_count: row.openConsultationCount,
      opened_at: row.openedAt.toISOString(), closed_at: row.closedAt?.toISOString() ?? null,
    };
  },
  consultation_requests: async (id) => {
    const row = await prisma.consultationRequest.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, care_thread_id: row.careThreadId, patient_profile_id: row.patientProfileId,
      assigned_clinician_id: row.assignedClinicianId, status: row.status,
      urgency_level: row.urgencyLevel, channel: row.channel, modality: row.modality,
      sla_deadline_at: row.slaDeadlineAt.toISOString(),
    };
  },
  appointments: async (id) => {
    const row = await prisma.appointment.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, slot_id: row.slotId, patient_profile_id: row.patientProfileId,
      clinician_id: row.clinicianId, starts_at: row.startsAt.toISOString(),
      duration_minutes: row.durationMin, status: row.status,
    };
  },
  messages: async (id) => {
    const row = await prisma.message.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, care_thread_id: row.careThreadId, consultation_id: row.consultationId,
      sender_user_id: row.senderUserId, body: row.body, attachment_key: row.attachmentKey,
      read_at: row.readAt?.toISOString() ?? null, created_at: row.createdAt.toISOString(),
    };
  },
  adherence_logs: async (id) => {
    const row = await prisma.adherenceLog.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, prescription_item_id: row.prescriptionItemId, patient_profile_id: row.patientProfileId,
      medication_name: row.medicationName, dosage: row.dosage,
      scheduled_at: row.scheduledAt.toISOString(), reported_status: row.reportedStatus,
      reported_at: row.reportedAt?.toISOString() ?? null,
    };
  },
  check_ins: async (id) => {
    const row = await prisma.checkIn.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, follow_up_cycle_id: row.followUpCycleId, care_thread_id: row.careThreadId,
      scheduled_at: row.scheduledAt.toISOString(), status: row.status,
      is_deviation: row.isDeviation, responded_at: row.respondedAt?.toISOString() ?? null,
    };
  },
  patient_profiles: async (id) => {
    const row = await prisma.patientProfile.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, full_name: row.fullName, date_of_birth: row.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      sex: row.sex, region_code: row.regionCode,
    };
  },
};
