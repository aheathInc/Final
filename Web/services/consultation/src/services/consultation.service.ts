import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, recordChange, toCursorPage } from '@a-health/http';
import { env } from '../config/env.js';
import { slaSecondsFor, triageWith, type Urgency } from '../engine/triage.js';
import { activeRuleset } from './ruleset.service.js';
import { fanoutFor, rank, type Candidate } from '../engine/matching.js';
import type { Caller, Meta } from './careThread.service.js';
import { publishConsultationEvent } from '../events.js';



const OPEN_STATES = ['pending', 'offered', 'matched', 'in_progress', 'escalated'];

export function serialiseConsultation(c: {
  id: string;
  careThreadId: string;
  patientProfileId: string;
  assignedClinicianId: string | null;
  referredFromId: string | null;
  appointmentId: string | null;
  channel: string;
  modality: string;
  symptomText: string | null;
  structuredSymptoms: unknown;
  voiceNoteKey: string | null;
  urgencyLevel: string;
  triageRuleVersion: string;
  status: string;
  slaDeadlineAt: Date;
  escalationCount: number;
  createdAt: Date;
  clientCreatedAt: Date | null;
  acceptedAt: Date | null;
  completedAt: Date | null;
  version: number;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    care_thread_id: c.careThreadId,
    patient_profile_id: c.patientProfileId,
    assigned_clinician_id: c.assignedClinicianId,
    referred_from_consultation_id: c.referredFromId,
    appointment_id: c.appointmentId,
    channel: c.channel,
    modality: c.modality,
    symptom_text: c.symptomText,
    structured_symptoms: c.structuredSymptoms ?? [],
    voice_note_key: c.voiceNoteKey,
    urgency_level: c.urgencyLevel,
    triage_rule_version: c.triageRuleVersion,
    status: c.status,
    sla_deadline_at: c.slaDeadlineAt.toISOString(),
    escalation_count: c.escalationCount,
    created_at: c.createdAt.toISOString(),
    client_created_at: c.clientCreatedAt?.toISOString() ?? null,
    accepted_at: c.acceptedAt?.toISOString() ?? null,
    completed_at: c.completedAt?.toISOString() ?? null,
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
  };
}

/** Loads eligible clinicians and offers the case to the top of the ranking. */
export async function offerConsultation(consultationId: string, requestedClinicianId?: string): Promise<number> {
  const consultation = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
  });
  if (!consultation || !OPEN_STATES.includes(consultation.status)) return 0;
  if (consultation.assignedClinicianId) return 0;

  const clinicians = await prisma.clinicianProfile.findMany({
    where: {
      verificationStatus: 'verified',
      ...(requestedClinicianId ? { id: requestedClinicianId } : { isAvailable: true }),
    },
    include: { facility: true },
    take: 200,
  });

  const candidates: Candidate[] = clinicians.map((c) => ({
    clinicianId: c.id,
    specialty: c.specialty,
    languages: Array.isArray(c.languagesSpoken) ? (c.languagesSpoken as string[]) : [],
    currentLoad: c.currentLoad,
    maxLoad: env.MAX_CLINICIAN_LOAD,
    ratingAvg: c.ratingAvg === null ? null : Number(c.ratingAvg),
    lat: c.facility?.lat ?? null,
    lng: c.facility?.lng ?? null,
  }));

  const ranked = rank(candidates, {
    requiredSpecialty: 'general_practice',
    patientLanguage: 'sw',
    patientLat: consultation.requestLat,
    patientLng: consultation.requestLng,
    urgency: consultation.urgencyLevel as Urgency,
  });

  const fanout = fanoutFor(consultation.urgencyLevel, consultation.escalationCount, env.OFFER_FANOUT);
  const chosen = ranked.slice(0, fanout);
  if (chosen.length === 0) return 0;

  const expiresAt = new Date(Date.now() + env.OFFER_TTL_SECONDS * 1000);
  await prisma.consultationOffer.createMany({
    data: chosen.map((c) => ({
      consultationId,
      clinicianId: c.clinicianId,
      rankScore: c.score,
      rankWeights: c.weights,
      expiresAt,
    })),
    skipDuplicates: true,
  });

  await prisma.consultationRequest.update({
    where: { id: consultationId },
    data: { status: 'offered', version: { increment: 1 } },
  });

  return chosen.length;
}

export async function createConsultation(
  caller: Caller,
  input: {
    care_thread_id?: string;
    patient_profile_id?: string;
    channel: string;
    modality?: string;
    symptom_text?: string;
    structured_symptoms?: { code: string; severity?: number; duration_hours?: number }[];
    voice_note_key?: string;
    location?: { lat: number; lng: number };
    client_created_at?: string;
    clinician_id?: string;
  },
  meta: Meta,
) {
  const patientProfileId = input.patient_profile_id ?? caller.ppid;
  if (!patientProfileId) throw forbidden('ROLE_NOT_PERMITTED', 'No patient profile for this request');

  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');

  if (caller.role === 'patient' && patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot raise a consultation for this patient');
  }

  if (input.clinician_id) {
    const clinician = await prisma.clinicianProfile.findUnique({
      where: { id: input.clinician_id },
      include: { user: { select: { status: true } } },
    });
    if (!clinician || clinician.verificationStatus !== 'verified' || clinician.user.status !== 'active') {
      throw notFound('Selected clinician is not available for consultations');
    }
  }

  const ageYears = patient.dateOfBirth
    ? Math.floor((Date.now() - patient.dateOfBirth.getTime()) / 31557600000)
    : null;

  const symptoms = input.structured_symptoms ?? [];
  const severityByCode: Record<string, number> = {};
  const durationByCode: Record<string, number> = {};
  for (const s of symptoms) {
    if (s.severity != null) severityByCode[s.code] = s.severity;
    if (s.duration_hours != null) durationByCode[s.code] = s.duration_hours;
  }

  const ruleset = await activeRuleset();
  const result = triageWith({
    symptomCodes: symptoms.map((s) => s.code),
    severityByCode,
    durationHoursByCode: durationByCode,
    freeText: input.symptom_text,
    ageYears,
    chronicConditions: Array.isArray(patient.chronicConditions) ? (patient.chronicConditions as string[]) : [],
  }, ruleset);

  const slaDeadlineAt = new Date(Date.now() + slaSecondsFor(result.urgency, ruleset.sla) * 1000);

  const consultation = await prisma.$transaction(async (tx) => {
    let threadId = input.care_thread_id;

    if (threadId) {
      const thread = await tx.careThread.findUnique({ where: { id: threadId } });
      if (!thread) throw notFound('Care thread not found');
      if (thread.status === 'closed') {
        // A deviation weeks after discharge belongs to the same problem, so a
        // new consultation reopens the thread rather than orphaning itself.
        await tx.careThread.update({
          where: { id: threadId },
          data: { status: 'open', closedAt: null, outcome: null, version: { increment: 1 } },
        });
      }
    } else {
      const summary = (input.symptom_text ?? symptoms.map((s) => s.code).join(', ')).slice(0, 300);
      const thread = await tx.careThread.create({
        data: { patientProfileId, reasonSummary: summary },
      });
      threadId = thread.id;
      await recordChange(tx, {
        entity: 'care_threads', entityId: thread.id, op: 'create',
        version: thread.version, patientProfileId, careThreadId: thread.id,
      });
    }

    const created = await tx.consultationRequest.create({
      data: {
        careThreadId: threadId,
        patientProfileId,
        channel: input.channel as never,
        modality: (input.modality ?? 'chat') as never,
        symptomText: input.symptom_text ?? null,
        structuredSymptoms: symptoms as never,
        voiceNoteKey: input.voice_note_key ?? null,
        requestLat: input.location?.lat ?? null,
        requestLng: input.location?.lng ?? null,
        urgencyLevel: result.urgency as never,
        triageRuleVersion: result.ruleVersion,
        slaDeadlineAt,
        clientCreatedAt: input.client_created_at ? new Date(input.client_created_at) : null,
      },
    });

    await tx.careThread.update({
      where: { id: threadId },
      data: {
        latestConsultationId: created.id,
        openConsultationCount: { increment: 1 },
        version: { increment: 1 },
      },
    });

    await recordChange(tx, {
      entity: 'consultation_requests', entityId: created.id, op: 'create',
      version: created.version, patientProfileId, careThreadId: threadId,
    });
    return created;
  });

  await appendAudit({
    actorUserId: caller.sub,
    action: 'consultation.created',
    entityType: 'consultation_requests',
    entityId: consultation.id,
    metadata: { urgency: result.urgency, rules: result.matchedRules, ruleVersion: result.ruleVersion },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  // Routing is asynchronous. The caller gets the request back immediately and
  // learns of assignment over the realtime channel.
  void offerConsultation(consultation.id, input.clinician_id).catch(() => undefined);

  return serialiseConsultation(consultation);
}

/**
 * First accept wins. Losers get 409, which the client must treat as an ordinary
 * outcome rather than an error to shout about — several clinicians racing for
 * the same case is the system working.
 */
export async function acceptConsultation(consultationId: string, caller: Caller, meta: Meta) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  const offer = await prisma.consultationOffer.findUnique({
    where: { consultationId_clinicianId: { consultationId, clinicianId: cpid } },
  });
  if (!offer) throw forbidden('FORBIDDEN', 'This case was not offered to you');

  const claimed = await prisma.consultationRequest.updateMany({
    where: {
      id: consultationId,
      assignedClinicianId: null,
      status: { in: ['pending', 'offered', 'escalated'] },
    },
    data: {
      assignedClinicianId: cpid,
      status: 'matched',
      acceptedAt: new Date(),
      version: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    throw conflict('CONSULTATION_ALREADY_ASSIGNED', 'Another clinician has taken this case');
  }

  await prisma.$transaction([
    prisma.consultationOffer.update({
      where: { consultationId_clinicianId: { consultationId, clinicianId: cpid } },
      data: { status: 'accepted', respondedAt: new Date(), version: { increment: 1 } },
    }),
    prisma.consultationOffer.updateMany({
      where: { consultationId, clinicianId: { not: cpid }, status: 'offered' },
      data: { status: 'expired', respondedAt: new Date() },
    }),
    prisma.clinicianProfile.update({
      where: { id: cpid },
      data: { currentLoad: { increment: 1 }, version: { increment: 1 } },
    }),
  ]);

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.accepted',
    entityType: 'consultation_requests', entityId: consultationId,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  const updated = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: consultationId } });

  await publishConsultationEvent(
    'consultation.assigned', consultationId, updated.careThreadId, updated.version,
    { clinician_id: cpid },
  );

  return serialiseConsultation(updated);
}

/** Declining does not stop the SLA clock — the case goes straight back out. */
export async function declineConsultation(
  consultationId: string, caller: Caller, reason: string | undefined, meta: Meta,
) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  await prisma.consultationOffer.updateMany({
    where: { consultationId, clinicianId: cpid, status: 'offered' },
    data: { status: 'declined', declineReason: reason ?? null, respondedAt: new Date() },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.declined',
    entityType: 'consultation_requests', entityId: consultationId,
    metadata: { reason: reason ?? null }, ipAddress: meta.ip, requestId: meta.requestId,
  });

  void offerConsultation(consultationId).catch(() => undefined);

  const updated = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: consultationId } });
  return serialiseConsultation(updated);
}

/**
 * The composite write: note, optional prescription, optional follow-up cycle,
 * in one atomic call. Three sequential writes over an unreliable network can
 * leave a consultation closed with no follow-up attached, which is precisely
 * the gap this platform exists to close.
 */
export async function completeConsultation(
  consultationId: string,
  caller: Caller,
  input: {
    note: { diagnosis_text: string; diagnosis_codes?: string[]; advice_text: string; red_flags_discussed?: string[] };
    prescription?: { items: { medication_name: string; dosage: string; frequency_per_day: number; duration_days: number; instructions?: string }[] };
    follow_up_cycle?: { frequency: string; custom_cron?: string; duration_days: number; questionnaire_key?: string; recovery_criteria?: Record<string, unknown> };
    close_care_thread?: boolean;
  },
  meta: Meta,
) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  const consultation = await prisma.consultationRequest.findUnique({ where: { id: consultationId } });
  if (!consultation) throw notFound('Consultation not found');
  if (consultation.assignedClinicianId !== cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not assigned to this consultation');
  }
  if (consultation.status === 'completed') {
    throw conflict('STATE_TRANSITION_INVALID', 'This consultation is already complete');
  }

  const clinician = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: cpid } });
  if (clinician.verificationStatus !== 'verified') {
    throw forbidden('CLINICIAN_NOT_VERIFIED', 'Your licence has not been verified');
  }

  const result = await prisma.$transaction(async (tx) => {
    const completed = await tx.consultationRequest.update({
      where: { id: consultationId },
      data: { status: 'completed', completedAt: new Date(), version: { increment: 1 } },
    });

    // The signature is stamped server-side after checking the signer.
    // Client-supplied signature fields are never trusted.
    const note = await tx.consultationNote.create({
      data: {
        consultationId,
        careThreadId: consultation.careThreadId,
        diagnosisText: input.note.diagnosis_text,
        diagnosisCodes: (input.note.diagnosis_codes ?? []) as never,
        adviceText: input.note.advice_text,
        redFlagsDiscussed: (input.note.red_flags_discussed ?? []) as never,
        signedByClinicianId: cpid,
        signedAt: new Date(),
      },
    });

    let prescriptionId: string | null = null;
    if (input.prescription && input.prescription.items.length > 0) {
      const prescription = await tx.prescription.create({
        data: {
          careThreadId: consultation.careThreadId,
          consultationId,
          patientProfileId: consultation.patientProfileId,
          prescribedById: cpid,
          items: {
            create: input.prescription.items.map((i) => ({
              medicationName: i.medication_name,
              dosage: i.dosage,
              frequencyPerDay: i.frequency_per_day,
              durationDays: i.duration_days,
              instructions: i.instructions ?? null,
            })),
          },
        },
        include: { items: true },
      });
      prescriptionId = prescription.id;

      // One row per expected dose, generated now. The reminder has to fire from
      // a cached row with no connectivity, so the schedule cannot be computed
      // later on the server.
      const doses: {
        prescriptionItemId: string; prescriptionId: string; patientProfileId: string;
        medicationName: string; dosage: string; scheduledAt: Date;
      }[] = [];
      const start = Date.now();
      for (const item of prescription.items) {
        const gap = 86400000 / item.frequencyPerDay;
        for (let d = 0; d < item.durationDays; d += 1) {
          for (let n = 0; n < item.frequencyPerDay; n += 1) {
            doses.push({
              prescriptionItemId: item.id,
              prescriptionId: prescription.id,
              patientProfileId: consultation.patientProfileId,
              medicationName: item.medicationName,
              dosage: item.dosage,
              scheduledAt: new Date(start + d * 86400000 + n * gap),
            });
          }
        }
      }
      if (doses.length > 0) await tx.adherenceLog.createMany({ data: doses });
    }

    let followUpCycleId: string | null = null;
    if (input.follow_up_cycle) {
      const cycle = await tx.followUpCycle.create({
        data: {
          careThreadId: consultation.careThreadId,
          patientProfileId: consultation.patientProfileId,
          clinicianId: cpid,
          sourceConsultationId: consultationId,
          frequency: input.follow_up_cycle.frequency as never,
          customCron: input.follow_up_cycle.custom_cron ?? null,
          questionnaireKey: input.follow_up_cycle.questionnaire_key ?? null,
          recoveryCriteria: (input.follow_up_cycle.recovery_criteria ?? {}) as never,
          startDate: new Date(),
          endDate: new Date(Date.now() + input.follow_up_cycle.duration_days * 86400000),
        },
      });
      followUpCycleId = cycle.id;
      await tx.careThread.update({
        where: { id: consultation.careThreadId },
        data: { activeFollowUpCycleId: cycle.id },
      });
    }

    await tx.careThread.update({
      where: { id: consultation.careThreadId },
      data: {
        openConsultationCount: { decrement: 1 },
        primaryClinicianId: cpid,
        ...(input.close_care_thread
          ? { status: 'closed' as never, outcome: 'recovered' as never, closedAt: new Date() }
          : {}),
        version: { increment: 1 },
      },
    });

    await tx.clinicianProfile.update({
      where: { id: cpid },
      data: { currentLoad: { decrement: 1 }, version: { increment: 1 } },
    });

    await recordChange(tx, {
      entity: 'consultation_requests', entityId: consultationId, op: 'update',
      version: completed.version, patientProfileId: consultation.patientProfileId,
      careThreadId: consultation.careThreadId,
    });

    return { completed, note, prescriptionId, followUpCycleId };
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.completed',
    entityType: 'consultation_requests', entityId: consultationId,
    metadata: { prescribed: result.prescriptionId !== null, followUp: result.followUpCycleId !== null },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  await publishConsultationEvent(
    'consultation.completed', consultationId, consultation.careThreadId, result.completed.version,
    { prescribed: result.prescriptionId !== null, follow_up: result.followUpCycleId !== null },
  );

  return {
    consultation: serialiseConsultation(result.completed),
    note: {
      id: result.note.id,
      signed_by_clinician_id: result.note.signedByClinicianId,
      signed_at: result.note.signedAt.toISOString(),
    },
    prescription_id: result.prescriptionId,
    follow_up_cycle_id: result.followUpCycleId,
  };
}

export async function referConsultation(
  consultationId: string,
  caller: Caller,
  input: { specialty: string; to_clinician_id?: string; reason: string },
  meta: Meta,
) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  const source = await prisma.consultationRequest.findUnique({ where: { id: consultationId } });
  if (!source) throw notFound('Consultation not found');
  if (source.assignedClinicianId !== cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not assigned to this consultation');
  }

  // The referral joins the same thread. A specialist opinion is part of the
  // same episode, not a fresh case with no history.
  const referralRuleset = await activeRuleset();
  const referralSla = referralRuleset.sla.routine;

  const referral = await prisma.consultationRequest.create({
    data: {
      careThreadId: source.careThreadId,
      patientProfileId: source.patientProfileId,
      referredFromId: consultationId,
      assignedClinicianId: input.to_clinician_id ?? null,
      channel: source.channel,
      modality: 'async',
      symptomText: input.reason,
      structuredSymptoms: source.structuredSymptoms as never,
      urgencyLevel: source.urgencyLevel,
      triageRuleVersion: source.triageRuleVersion,
      status: input.to_clinician_id ? 'matched' : 'pending',
      slaDeadlineAt: new Date(Date.now() + referralSla * 1000),
    },
  });

  await prisma.careThread.update({
    where: { id: source.careThreadId },
    data: { openConsultationCount: { increment: 1 }, version: { increment: 1 } },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.referred',
    entityType: 'consultation_requests', entityId: referral.id,
    reason: input.reason, metadata: { specialty: input.specialty, from: consultationId },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  if (!input.to_clinician_id) void offerConsultation(referral.id).catch(() => undefined);
  return serialiseConsultation(referral);
}


function serialisePrescription(p: {
  id: string; careThreadId: string; consultationId: string; patientProfileId: string;
  prescribedById: string; status: string; createdAt: Date; version: number;
  items: { id: string; medicationName: string; dosage: string; frequencyPerDay: number; durationDays: number; instructions: string | null }[];
}) {
  return {
    id: p.id,
    care_thread_id: p.careThreadId,
    consultation_id: p.consultationId,
    patient_profile_id: p.patientProfileId,
    prescribed_by_id: p.prescribedById,
    status: p.status,
    items: p.items.map((i) => ({
      id: i.id,
      medication_name: i.medicationName,
      dosage: i.dosage,
      frequency_per_day: i.frequencyPerDay,
      duration_days: i.durationDays,
      instructions: i.instructions,
    })),
    created_at: p.createdAt.toISOString(),
    version: p.version,
  };
}

async function assertPrescriptionVisible(
  prescription: { patientProfileId: string; prescribedById: string },
  caller: Caller,
): Promise<void> {
  if (caller.role === 'platform_admin') return;
  if (caller.cpid && prescription.prescribedById === caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: prescription.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This prescription is not yours');
}

/** The read half of prescriptions — writing already happens inside completeConsultation(); this was the missing counterpart. */
export async function getPrescription(prescriptionId: string, caller: Caller) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId }, include: { items: true },
  });
  if (!prescription) throw notFound('Prescription not found');
  await assertPrescriptionVisible(prescription, caller);
  return serialisePrescription(prescription);
}

export async function listPatientPrescriptions(
  patientProfileId: string, caller: Caller, query: { cursor?: string; limit: number },
) {
  if (caller.role !== 'platform_admin' && !caller.cpid) {
    const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
    if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view this patient\\u2019s prescriptions');
  }
  const rows = await prisma.prescription.findMany({
    where: { patientProfileId },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialisePrescription);
}


/**
 * Visibility for a single consultation: the patient it belongs to (or their
 * guardian), the clinician it is assigned to, or an admin.
 *
 * A clinician who was merely OFFERED the case and declined is not included —
 * the offer let them see a summary in order to decide, and declining ends
 * that, rather than leaving them a permanent window into someone's care.
 */
async function assertConsultationVisible(
  c: { patientProfileId: string; assignedClinicianId: string | null },
  caller: Caller,
): Promise<void> {
  if (caller.role === 'platform_admin') return;
  if (caller.cpid && c.assignedClinicianId === caller.cpid) return;

  const patient = await prisma.patientProfile.findUnique({ where: { id: c.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This consultation is not yours');
}

export async function getConsultation(consultationId: string, caller: Caller) {
  const c = await prisma.consultationRequest.findUnique({ where: { id: consultationId } });
  if (!c) throw notFound('Consultation not found');
  await assertConsultationVisible(c, caller);
  return serialiseConsultation(c);
}

export async function listConsultations(
  caller: Caller,
  query: { status?: string; care_thread_id?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { assignedClinicianId: caller.cpid }
        : { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } };

  const rows = await prisma.consultationRequest.findMany({
    where: {
      ...scope,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.care_thread_id ? { careThreadId: query.care_thread_id } : {}),
    },
    orderBy: { createdAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseConsultation);
}

/**
 * The signed note. Readable only once it exists — an unfinished consultation
 * has no advice to give, and returning an empty shell would read as "the
 * clinician said nothing" rather than "the clinician has not finished".
 */
export async function getConsultationNote(consultationId: string, caller: Caller) {
  const c = await prisma.consultationRequest.findUnique({ where: { id: consultationId } });
  if (!c) throw notFound('Consultation not found');
  await assertConsultationVisible(c, caller);

  const note = await prisma.consultationNote.findUnique({ where: { consultationId } });
  if (!note) throw notFound('This consultation has no note yet');

  return {
    id: note.id,
    consultation_id: note.consultationId,
    care_thread_id: note.careThreadId,
    diagnosis_text: note.diagnosisText,
    diagnosis_codes: note.diagnosisCodes,
    advice_text: note.adviceText,
    red_flags_discussed: note.redFlagsDiscussed,
    referred_specialist_id: note.referredSpecialistId,
    signed_by_clinician_id: note.signedByClinicianId,
    signed_at: note.signedAt.toISOString(),
    version: note.version,
  };
}
