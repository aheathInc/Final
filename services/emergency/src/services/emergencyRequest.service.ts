import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage, unprocessable } from '@a-health/http';
import { canDispatch, isLegalStatusTransition, type EmergencyStatus } from './transition.js';
import { resolveEmergencyContext } from './consentContext.js';
import { publishEmergencyEvent } from '../events.js';

export interface Caller { sub?: string; role?: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(e: {
  id: string; scale: string; category: string; source: string; status: string; outcome: string | null;
  lat: number; lng: number; patientProfileId: string | null; estimatedCasualties: number | null;
  description: string | null; transportUnitId: string | null; destinationFacilityId: string | null;
  reportedAt: Date; dispatchedAt: Date | null; arrivedAt: Date | null; resolvedAt: Date | null;
  version: number;
}) {
  return {
    id: e.id,
    scale: e.scale,
    category: e.category,
    source: e.source,
    status: e.status,
    outcome: e.outcome,
    location: { lat: e.lat, lng: e.lng },
    patient_profile_id: e.patientProfileId,
    estimated_casualties: e.estimatedCasualties,
    description: e.description,
    transport_unit_id: e.transportUnitId,
    destination_facility_id: e.destinationFacilityId,
    reported_at: e.reportedAt.toISOString(),
    dispatched_at: e.dispatchedAt?.toISOString() ?? null,
    arrived_at: e.arrivedAt?.toISOString() ?? null,
    resolved_at: e.resolvedAt?.toISOString() ?? null,
    version: e.version,
  };
}

/**
 * Deliberately tolerant of missing information. A bystander reporting a road
 * crash may know nothing about the injured beyond where they are — `caller`
 * may be entirely absent, which is why this accepts an optional caller rather
 * than requiring one.
 */
export async function createEmergencyRequest(
  caller: Caller,
  input: {
    scale: string; category?: string; location: { lat: number; lng: number };
    patient_profile_id?: string; estimated_casualties?: number; description?: string;
    reporter_phone?: string; source?: string; channel?: string;
  },
) {
  const source = input.source ?? (caller.sub ? 'patient_app' : 'bystander');

  const emergency = await prisma.$transaction(async (tx) => {
    const created = await tx.emergencyRequest.create({
      data: {
        scale: input.scale as never,
        category: (input.category ?? 'other') as never,
        source: source as never,
        status: 'reported',
        lat: input.location.lat,
        lng: input.location.lng,
        patientProfileId: input.patient_profile_id ?? null,
        reportedByUserId: caller.sub ?? null,
        reporterPhone: input.reporter_phone ?? null,
        estimatedCasualties: input.estimated_casualties ?? null,
        description: input.description ?? null,
      },
    });
    await tx.emergencyEvent.create({
      data: { emergencyId: created.id, toStatus: 'reported', actorUserId: caller.sub ?? null },
    });
    return created;
  });

  await appendAudit({
    actorUserId: caller.sub ?? null,
    action: 'emergency.reported',
    entityType: 'emergency_requests',
    entityId: emergency.id,
    metadata: { scale: input.scale, source },
  });

  return serialise(emergency);
}

async function assertVisible(emergencyId: string, caller: Caller) {
  const emergency = await prisma.emergencyRequest.findUnique({
    where: { id: emergencyId },
    include: { patient: { select: { userId: true, guardianUserId: true } } },
  });
  if (!emergency) throw notFound('Emergency not found');

  const privileged = caller.role === 'dispatcher' || caller.role === 'platform_admin';
  const isReporter = caller.sub && emergency.reportedByUserId === caller.sub;
  const isPatient = caller.sub && (emergency.patient?.userId === caller.sub || emergency.patient?.guardianUserId === caller.sub);

  if (!privileged && !isReporter && !isPatient) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view this emergency');
  }
  return emergency;
}

export async function getEmergencyRequest(emergencyId: string, caller: Caller) {
  const emergency = await assertVisible(emergencyId, caller);
  return serialise(emergency);
}

export async function listEmergencyRequests(
  caller: Caller,
  query: { status?: string; facility_id?: string; cursor?: string; limit: number },
) {
  if (caller.role !== 'dispatcher' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only dispatchers may list emergencies');
  }
  const rows = await prisma.emergencyRequest.findMany({
    where: {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.facility_id ? { destinationFacilityId: query.facility_id } : {}),
    },
    orderBy: [{ scale: 'desc' }, { reportedAt: 'asc' }],
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialise);
}

/**
 * Assigns transport and a receiving facility, and — where the patient is
 * known — resolves what context may travel with them, consent-checked.
 *
 * Only legal from `reported` or `triaged`. This is the one place `dispatched`
 * is ever entered; the generic status endpoint refuses to produce it.
 */
export async function dispatchEmergency(
  emergencyId: string, caller: Caller,
  input: { transport_unit_id: string; destination_facility_id: string; notes?: string },
  meta: Meta,
) {
  const emergency = await prisma.emergencyRequest.findUnique({ where: { id: emergencyId } });
  if (!emergency) throw notFound('Emergency not found');
  if (!canDispatch(emergency.status as EmergencyStatus)) {
    throw conflict('STATE_TRANSITION_INVALID', `Cannot dispatch from status "${emergency.status}"`);
  }

  const unit = await prisma.transportUnit.findUnique({ where: { id: input.transport_unit_id } });
  if (!unit) throw notFound('Transport unit not found');
  if (unit.status === 'out_of_service') {
    throw conflict('STATE_TRANSITION_INVALID', 'Transport unit is out of service');
  }

  const facility = await prisma.facility.findUnique({ where: { id: input.destination_facility_id } });
  if (!facility) throw notFound('Destination facility not found');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.emergencyRequest.update({
      where: { id: emergencyId },
      data: {
        transportUnitId: input.transport_unit_id,
        destinationFacilityId: input.destination_facility_id,
        status: 'dispatched',
        dispatchedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await tx.transportUnit.update({
      where: { id: input.transport_unit_id },
      data: { status: 'dispatched', version: { increment: 1 } },
    });
    await tx.emergencyEvent.create({
      data: {
        emergencyId, fromStatus: emergency.status as never, toStatus: 'dispatched',
        actorUserId: caller.sub ?? null, notes: input.notes ?? null,
      },
    });
    return row;
  });

  let context = null;
  if (emergency.patientProfileId) {
    context = await resolveEmergencyContext(emergency.patientProfileId, emergencyId, caller.sub);
  }

  await appendAudit({
    actorUserId: caller.sub ?? null,
    action: 'emergency.dispatched',
    entityType: 'emergency_requests',
    entityId: emergencyId,
    metadata: { transportUnitId: input.transport_unit_id, destinationFacilityId: input.destination_facility_id },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  await publishEmergencyEvent(emergencyId, { status: 'dispatched', context_shared: context !== null });

  return { ...serialise(updated), context_shared: context !== null, break_glass: context?.breakGlass ?? false };
}

export async function setEmergencyStatus(
  emergencyId: string, caller: Caller,
  input: { status: string; outcome?: string; notes?: string },
  meta: Meta,
) {
  if (caller.role !== 'dispatcher' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only dispatchers may update emergency status');
  }

  const emergency = await prisma.emergencyRequest.findUnique({ where: { id: emergencyId } });
  if (!emergency) throw notFound('Emergency not found');

  const from = emergency.status as EmergencyStatus;
  const to = input.status as EmergencyStatus;
  if (!isLegalStatusTransition(from, to)) {
    throw conflict('STATE_TRANSITION_INVALID', `Cannot move from "${from}" to "${to}"`);
  }
  if (to === 'resolved' && !input.outcome) {
    throw unprocessable('An outcome is required to resolve an emergency', 'outcome');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.emergencyRequest.update({
      where: { id: emergencyId },
      data: {
        status: to as never,
        ...(input.outcome ? { outcome: input.outcome as never } : {}),
        ...(to === 'arrived' ? { arrivedAt: new Date() } : {}),
        ...(to === 'resolved' || to === 'cancelled' ? { resolvedAt: new Date() } : {}),
        version: { increment: 1 },
      },
    });
    await tx.emergencyEvent.create({
      data: { emergencyId, fromStatus: from, toStatus: to, actorUserId: caller.sub ?? null, notes: input.notes ?? null },
    });
    return row;
  });

  await appendAudit({
    actorUserId: caller.sub ?? null, action: 'emergency.status_changed',
    entityType: 'emergency_requests', entityId: emergencyId,
    metadata: { from, to, outcome: input.outcome ?? null },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  await publishEmergencyEvent(emergencyId, { status: to });

  return serialise(updated);
}
