import { prisma } from '@a-health/database';
import {
  appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage,
} from '@a-health/http';
import { computeFlag, isCriticalFlag } from '../engine/resultFlag.js';
import type { CreateOrderInput, FileResultInput } from '../types/diagnostics.types.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseOrder(o: {
  id: string; careThreadId: string; consultationId: string | null; patientProfileId: string;
  orderedById: string; facilityId: string | null; investigationCode: string; investigationType: string;
  urgency: string; status: string; clinicalNotes: string | null; narrative: string | null;
  attachmentKey: string | null; isCritical: boolean; acknowledgedById: string | null;
  acknowledgedAt: Date | null; orderedAt: Date; resultedAt: Date | null; version: number;
  values?: { analyte: string; value: string; unit: string | null; referenceLow: unknown; referenceHigh: unknown; flag: string }[];
}, caller: Caller) {
  return {
    id: o.id,
    care_thread_id: o.careThreadId,
    consultation_id: o.consultationId,
    patient_profile_id: o.patientProfileId,
    ordered_by_id: o.orderedById,
    facility_id: o.facilityId,
    investigation_code: o.investigationCode,
    investigation_type: o.investigationType,
    urgency: o.urgency,
    status: o.status,
    ...(caller.role === 'patient' || caller.role === 'guardian'
      ? {}
      : { clinical_notes: o.clinicalNotes }),
    values: (o.values ?? []).map((v) => ({
      analyte: v.analyte,
      value: v.value,
      unit: v.unit,
      reference_low: v.referenceLow === null ? null : Number(v.referenceLow),
      reference_high: v.referenceHigh === null ? null : Number(v.referenceHigh),
      flag: v.flag,
    })),
    narrative: o.narrative,
    attachment_key: o.attachmentKey,
    is_critical: o.isCritical,
    acknowledged_by_id: o.acknowledgedById,
    acknowledged_at: o.acknowledgedAt?.toISOString() ?? null,
    ordered_at: o.orderedAt.toISOString(),
    resulted_at: o.resultedAt?.toISOString() ?? null,
    version: o.version,
  };
}

async function assertVisible(order: { patientProfileId: string; orderedById: string }, caller: Caller) {
  if (caller.role === 'platform_admin') return;
  if (caller.cpid && order.orderedById === caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: order.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This investigation order is not yours');
}

/**
 * Orders an investigation. Clinician only — ordering is a clinical decision,
 * not something a patient or an unrelated party can initiate.
 */
export async function createOrder(caller: Caller, input: CreateOrderInput, meta: Meta) {
  if (!caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required to order an investigation');

  const thread = await prisma.careThread.findUnique({ where: { id: input.care_thread_id } });
  if (!thread) throw notFound('Care thread not found');

  const order = await prisma.investigationOrder.create({
    data: {
      careThreadId: input.care_thread_id,
      consultationId: input.consultation_id ?? null,
      patientProfileId: thread.patientProfileId,
      orderedById: caller.cpid,
      facilityId: input.facility_id ?? null,
      investigationCode: input.investigation_code,
      investigationType: input.investigation_type as never,
      urgency: (input.urgency ?? 'routine') as never,
      clinicalNotes: input.clinical_notes ?? null,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'investigation.ordered',
    entityType: 'investigation_orders', entityId: order.id,
    metadata: { investigationCode: input.investigation_code, urgency: order.urgency },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseOrder(order, caller);
}

export async function getOrder(orderId: string, caller: Caller) {
  const order = await prisma.investigationOrder.findUnique({
    where: { id: orderId },
    include: { values: true },
  });
  if (!order) throw notFound('Investigation order not found');
  await assertVisible(order, caller);
  return serialiseOrder(order, caller);
}

export async function listOrders(
  caller: Caller,
  query: { care_thread_id?: string; status?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { orderedById: caller.cpid }
        : { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } };

  const rows = await prisma.investigationOrder.findMany({
    where: {
      ...scope,
      ...(query.care_thread_id ? { careThreadId: query.care_thread_id } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    orderBy: [{ isCritical: 'desc' }, { orderedAt: 'desc' }],
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, (row) => serialiseOrder(row, caller));
}

/**
 * Files a result. `is_critical` and each value's `flag` are computed here,
 * from the order's own reference/critical bounds — never accepted from the
 * caller. A critical result is what makes this endpoint matter: it is the
 * moment a finding either starts escalating or quietly waits for someone to
 * open the chart, and this function is what decides which.
 */
export async function fileResult(orderId: string, caller: Caller, input: FileResultInput, meta: Meta) {
  const order = await prisma.investigationOrder.findUnique({ where: { id: orderId } });
  if (!order) throw notFound('Investigation order not found');
  if (caller.role !== 'platform_admin' && (
    caller.role !== 'clinician' || !caller.cpid || order.orderedById !== caller.cpid
  )) {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only the ordering clinician may file this result');
  }
  if (order.status === 'resulted' || order.status === 'acknowledged') {
    throw conflict('STATE_TRANSITION_INVALID', 'A result has already been filed for this order');
  }
  if (order.status === 'cancelled') {
    throw conflict('STATE_TRANSITION_INVALID', 'This order was cancelled');
  }

  const flaggedValues = input.values.map((v) => ({
    analyte: v.analyte,
    value: v.value,
    unit: v.unit ?? null,
    referenceLow: v.reference_low ?? null,
    referenceHigh: v.reference_high ?? null,
    flag: computeFlag({
      value: v.value,
      referenceLow: v.reference_low,
      referenceHigh: v.reference_high,
      criticalLow: v.critical_low,
      criticalHigh: v.critical_high,
    }),
  }));

  const isCritical = flaggedValues.some((v) => isCriticalFlag(v.flag as never));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.investigationValue.createMany({
      data: flaggedValues.map((v) => ({
        orderId,
        analyte: v.analyte,
        value: v.value,
        unit: v.unit,
        referenceLow: v.referenceLow,
        referenceHigh: v.referenceHigh,
        flag: v.flag as never,
      })),
    });

    return tx.investigationOrder.update({
      where: { id: orderId },
      data: {
        status: 'resulted',
        narrative: input.narrative ?? null,
        attachmentKey: input.attachment_key ?? null,
        isCritical,
        resultedAt: new Date(),
        version: { increment: 1 },
      },
      include: { values: true },
    });
  });

  await appendAudit({
    actorUserId: caller.sub,
    action: isCritical ? 'investigation.critical_result_filed' : 'investigation.result_filed',
    entityType: 'investigation_orders', entityId: orderId,
    metadata: { isCritical, analytes: flaggedValues.map((v) => v.analyte) },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseOrder(updated, caller);
}

/**
 * Closes the loop on a result. Until a clinician acknowledges, a critical
 * finding is not treated as received — silence is never treated as receipt.
 */
export async function acknowledgeResult(orderId: string, caller: Caller, meta: Meta) {
  if (!caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required to acknowledge a result');

  const order = await prisma.investigationOrder.findUnique({ where: { id: orderId } });
  if (!order) throw notFound('Investigation order not found');
  if (order.status === 'acknowledged') {
    throw conflict('RESULT_ALREADY_ACKNOWLEDGED', 'This result has already been acknowledged');
  }
  if (order.status !== 'resulted') {
    throw conflict('STATE_TRANSITION_INVALID', 'No result has been filed for this order yet');
  }

  const updated = await prisma.investigationOrder.update({
    where: { id: orderId },
    data: {
      status: 'acknowledged',
      acknowledgedById: caller.cpid,
      acknowledgedAt: new Date(),
      version: { increment: 1 },
    },
    include: { values: true },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'investigation.acknowledged',
    entityType: 'investigation_orders', entityId: orderId,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseOrder(updated, caller);
}
