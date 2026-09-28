import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage, unprocessable } from '@a-health/http';
import { env } from '../config/env.js';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseProgramme(p: { id: string; code: string; name: string; conditionCode: string; intervalMonths: number }) {
  return { id: p.id, code: p.code, name: p.name, condition_code: p.conditionCode, interval_months: p.intervalMonths };
}

export async function listProgrammes() {
  const rows = await prisma.screeningProgramme.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return { data: rows.map(serialiseProgramme) };
}

function serialiseInvitation(i: {
  id: string; programmeId: string; patientProfileId: string; status: string;
  declineReason: string | null; appointmentId: string | null; invitedAt: Date; respondedAt: Date | null;
}) {
  return {
    id: i.id,
    programme_id: i.programmeId,
    patient_profile_id: i.patientProfileId,
    status: i.status,
    decline_reason: i.declineReason,
    appointment_id: i.appointmentId,
    invited_at: i.invitedAt.toISOString(),
    responded_at: i.respondedAt?.toISOString() ?? null,
  };
}

export async function listInvitations(
  caller: Caller, query: { patient_profile_id?: string; status?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } };

  const rows = await prisma.screeningInvitation.findMany({
    where: {
      ...scope,
      ...(query.patient_profile_id ? { patientProfileId: query.patient_profile_id } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    orderBy: { invitedAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseInvitation);
}

/**
 * Accepting with a preferred slot books a REAL appointment through
 * services/appointment's own endpoint — the same reuse discipline as
 * sync's batch replay and devices' emergency-opening: booking has exactly
 * one implementation, and this is not a second one.
 *
 * Declining without a reason is rejected — why someone said no is the data
 * that tells you whether uptake is limited by distance, cost, fear, or
 * simply not knowing what the test is for, and that signal is lost the
 * moment a decline is allowed to be silent.
 */
export async function respondToInvitation(
  invitationId: string, caller: Caller,
  input: { response: 'accept' | 'decline' | 'defer'; decline_reason?: string; preferred_slot_id?: string },
  authHeader: string, meta: Meta,
) {
  const invitation = await prisma.screeningInvitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw notFound('Invitation not found');

  const patient = await prisma.patientProfile.findUnique({ where: { id: invitation.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This invitation is not yours');
  }
  if (invitation.status !== 'pending') {
    throw conflict('STATE_TRANSITION_INVALID', 'This invitation has already been responded to');
  }
  if (input.response === 'decline' && !input.decline_reason?.trim()) {
    throw unprocessable('A reason is required to decline a screening invitation', 'decline_reason');
  }

  let appointmentId: string | null = null;
  if (input.response === 'accept' && input.preferred_slot_id) {
    const bookingResponse = await fetch(`${env.APPOINTMENT_SERVICE_URL}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader, 'Idempotency-Key': `screen-${invitationId}` },
      body: JSON.stringify({ slot_id: input.preferred_slot_id, patient_profile_id: invitation.patientProfileId, reason: 'Screening appointment' }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (bookingResponse?.ok) {
      const body = (await bookingResponse.json()) as { id: string };
      appointmentId = body.id;
    }
  }

  const updated = await prisma.screeningInvitation.update({
    where: { id: invitationId },
    data: {
      status: input.response === 'accept' ? 'accepted' : input.response === 'decline' ? 'declined' : 'deferred',
      declineReason: input.response === 'decline' ? input.decline_reason : null,
      appointmentId,
      respondedAt: new Date(),
      version: { increment: 1 },
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'prevention.invitation_responded',
    entityType: 'screening_invitations', entityId: invitationId,
    metadata: { response: input.response },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseInvitation(updated);
}
