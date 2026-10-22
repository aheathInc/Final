import { prisma } from '@a-health/database';
import {
  appendAudit, conflict, cursorArgs, forbidden, notFound, recordChange, toCursorPage, unprocessable,
} from '@a-health/http';
import { env } from '../config/env.js';
import type { CreateAppointmentInput } from '../types/appointment.types.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseAppointment(a: {
  id: string; slotId: string; careThreadId: string | null; patientProfileId: string;
  clinicianId: string; consultationId?: string | null; startsAt: Date; durationMin: number;
  modality: string; reason: string | null; status: string; cancelledReason: string | null;
  version: number; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: a.id,
    slot_id: a.slotId,
    care_thread_id: a.careThreadId,
    patient_profile_id: a.patientProfileId,
    clinician_id: a.clinicianId,
    consultation_id: a.consultationId ?? null,
    starts_at: a.startsAt.toISOString(),
    duration_minutes: a.durationMin,
    modality: a.modality,
    reason: a.reason,
    status: a.status,
    cancelled_reason: a.cancelledReason,
    version: a.version,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

/** Minimal, contract-shaped serialiser — mirrors consultation.service's own, not imported across the service boundary. */
function serialiseConsultation(c: {
  id: string; careThreadId: string; patientProfileId: string; assignedClinicianId: string | null;
  appointmentId: string | null; channel: string; modality: string; urgencyLevel: string;
  triageRuleVersion: string; status: string; slaDeadlineAt: Date; escalationCount: number;
  createdAt: Date; acceptedAt: Date | null; completedAt: Date | null; version: number; updatedAt: Date;
}) {
  return {
    id: c.id,
    care_thread_id: c.careThreadId,
    patient_profile_id: c.patientProfileId,
    assigned_clinician_id: c.assignedClinicianId,
    referred_from_consultation_id: null,
    appointment_id: c.appointmentId,
    channel: c.channel,
    modality: c.modality,
    symptom_text: null,
    structured_symptoms: [],
    voice_note_key: null,
    urgency_level: c.urgencyLevel,
    triage_rule_version: c.triageRuleVersion,
    status: c.status,
    sla_deadline_at: c.slaDeadlineAt.toISOString(),
    escalation_count: c.escalationCount,
    created_at: c.createdAt.toISOString(),
    client_created_at: null,
    accepted_at: c.acceptedAt?.toISOString() ?? null,
    completed_at: c.completedAt?.toISOString() ?? null,
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
  };
}

async function resolvePatientProfileId(caller: Caller, requested: string | undefined): Promise<string> {
  const patientProfileId = requested ?? caller.ppid;
  if (!patientProfileId) throw forbidden('ROLE_NOT_PERMITTED', 'No patient profile for this request');
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');
  if (caller.role === 'patient' && patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot book an appointment for this patient');
  }
  return patientProfileId;
}

/**
 * Books a published slot.
 *
 * Slot contention is resolved by first write wins: the conditional update
 * (`isBooked: false` in the where clause) means a losing concurrent request
 * updates zero rows and is told the slot is gone, rather than double-booking
 * the clinician. Booking does not open a consultation — that is what start()
 * is for, kept separate so a no-show never leaves a clinical record behind.
 */
export async function createAppointment(caller: Caller, input: CreateAppointmentInput, meta: Meta) {
  const patientProfileId = await resolvePatientProfileId(caller, input.patient_profile_id);

  const slot = await prisma.slot.findUnique({ where: { id: input.slot_id } });
  if (!slot) throw notFound('Slot not found');
  if (slot.startsAt < new Date()) throw conflict('SLOT_IN_PAST', 'This slot has already passed');

  if (input.care_thread_id) {
    const thread = await prisma.careThread.findUnique({ where: { id: input.care_thread_id } });
    if (!thread) throw notFound('Care thread not found');
    if (thread.patientProfileId !== patientProfileId) {
      throw forbidden('NOT_RESOURCE_OWNER', 'That care thread does not belong to this patient');
    }
  }

  const claimed = await prisma.slot.updateMany({
    where: { id: input.slot_id, isBooked: false },
    data: { isBooked: true },
  });
  if (claimed.count !== 1) {
    throw conflict('SLOT_UNAVAILABLE', 'This slot has just been booked by someone else');
  }

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        slotId: slot.id,
        careThreadId: input.care_thread_id ?? null,
        patientProfileId,
        clinicianId: slot.clinicianId,
        startsAt: slot.startsAt,
        durationMin: slot.durationMin,
        modality: slot.modality,
        reason: input.reason ?? null,
      },
    });
    await recordChange(tx, {
      entity: 'appointments', entityId: created.id, op: 'create',
      version: created.version, patientProfileId, clinicianId: slot.clinicianId,
    });
    return created;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'appointment.booked',
    entityType: 'appointments', entityId: appointment.id,
    metadata: { slotId: slot.id, startsAt: slot.startsAt.toISOString() },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseAppointment(appointment);
}

async function assertVisible(appointment: { patientProfileId: string; clinicianId: string }, caller: Caller) {
  if (caller.role === 'platform_admin') return;
  if (caller.cpid && appointment.clinicianId === caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: appointment.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This appointment is not yours');
}

export async function getAppointment(appointmentId: string, caller: Caller) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw notFound('Appointment not found');
  await assertVisible(appointment, caller);
  return serialiseAppointment(appointment);
}

export async function listAppointments(
  caller: Caller,
  query: { status?: string; from?: string; to?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { clinicianId: caller.cpid }
        : { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } };

  const rows = await prisma.appointment.findMany({
    where: {
      ...scope,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.from || query.to
        ? { startsAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    },
    orderBy: { startsAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseAppointment);
}

/**
 * Opens the consultation for a booked appointment. The clinician is already
 * fixed by the booking, so this never touches the triage or matching engine
 * — it creates the ConsultationRequest directly in `matched` state.
 *
 * Callable by either party from START_WINDOW_MINUTES before the slot. If the
 * appointment carries no care_thread_id, one is opened here — and if the
 * thread it does carry was closed, it is reopened, the same rule
 * services/consultation applies when a problem resurfaces.
 */
export async function startAppointment(appointmentId: string, caller: Caller, meta: Meta) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw notFound('Appointment not found');
  await assertVisible(appointment, caller);

  if (appointment.status !== 'booked') {
    throw conflict('APPOINTMENT_ALREADY_STARTED', `This appointment is already "${appointment.status}"`);
  }
  const earliestStart = new Date(appointment.startsAt.getTime() - env.START_WINDOW_MINUTES * 60_000);
  if (new Date() < earliestStart) {
    throw conflict('APPOINTMENT_NOT_YET_STARTABLE', 'It is too early to start this appointment');
  }

  const result = await prisma.$transaction(async (tx) => {
    let threadId = appointment.careThreadId;

    if (threadId) {
      const thread = await tx.careThread.findUniqueOrThrow({ where: { id: threadId } });
      if (thread.status === 'closed') {
        await tx.careThread.update({
          where: { id: threadId },
          data: { status: 'open', closedAt: null, outcome: null, version: { increment: 1 } },
        });
      }
    } else {
      const thread = await tx.careThread.create({
        data: {
          patientProfileId: appointment.patientProfileId,
          reasonSummary: appointment.reason ?? 'Scheduled appointment',
        },
      });
      threadId = thread.id;
    }

    const consultation = await tx.consultationRequest.create({
      data: {
        careThreadId: threadId,
        patientProfileId: appointment.patientProfileId,
        assignedClinicianId: appointment.clinicianId,
        appointmentId: appointment.id,
        channel: 'app',
        modality: appointment.modality,
        // No triage ran: the clinician and time were fixed at booking, not
        // derived from symptoms. The version is recorded as a fixed marker
        // for the same audit reason every other consultation stamps a real
        // triage version — so a reviewer never mistakes this for a triage
        // decision that happened and was simply not logged.
        urgencyLevel: 'routine',
        triageRuleVersion: 'scheduled-appointment-no-triage',
        status: 'matched',
        acceptedAt: new Date(),
        slaDeadlineAt: new Date(Date.now() + env.SLA_ROUTINE_SECONDS * 1000),
      },
    });

    await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: 'started', version: { increment: 1 } },
    });

    await tx.careThread.update({
      where: { id: threadId },
      data: {
        latestConsultationId: consultation.id,
        openConsultationCount: { increment: 1 },
        version: { increment: 1 },
      },
    });

    await tx.clinicianProfile.update({
      where: { id: appointment.clinicianId },
      data: { currentLoad: { increment: 1 }, version: { increment: 1 } },
    });

    return consultation;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'appointment.started',
    entityType: 'appointments', entityId: appointment.id,
    metadata: { consultationId: result.id },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseConsultation(result);
}

/**
 * Cancelling releases the slot back to the pool. Only legal while `booked` —
 * once started, a consultation may already be in progress, and "cancelling"
 * that is a clinical action (closing the consultation), not a scheduling one.
 */
export async function cancelAppointment(appointmentId: string, caller: Caller, reason: string | undefined, meta: Meta) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw notFound('Appointment not found');
  await assertVisible(appointment, caller);

  if (appointment.status !== 'booked') {
    throw conflict('STATE_TRANSITION_INVALID', `Cannot cancel an appointment in status "${appointment.status}"`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: 'cancelled', cancelledReason: reason ?? null, version: { increment: 1 } },
    });
    await tx.slot.update({ where: { id: appointment.slotId }, data: { isBooked: false } });
    return row;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'appointment.cancelled',
    entityType: 'appointments', entityId: appointment.id,
    reason: reason ?? null, ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseAppointment(updated);
}
