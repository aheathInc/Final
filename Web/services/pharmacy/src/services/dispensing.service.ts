import { prisma } from '@a-health/database';
import { conflict, forbidden, notFound, sha256, unauthenticated, unprocessable } from '@a-health/http';
import { randomInt } from 'node:crypto';
import { env } from '../config/env.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function generateCode(): string {
  // Six digits, same shape as the OTP — easy to read aloud at a counter, hard
  // to guess within the short window it is valid for.
  let out = '';
  for (let i = 0; i < 6; i += 1) out += randomInt(0, 10).toString();
  return out;
}

/**
 * Issues a short-lived, single-pharmacy-redeemable code for a prescription.
 *
 * Restricted to the prescription's owner or their guardian, or the
 * prescriber — a stranger must not be able to mint a code for someone else's
 * medication. Only an active prescription can be coded; a completed or
 * discontinued one has nothing left to dispense.
 */
export async function issueDispenseCode(prescriptionId: string, caller: Caller, meta: Meta) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: { patient: { select: { userId: true, guardianUserId: true } } },
  });
  if (!prescription) throw notFound('Prescription not found');

  const owns =
    prescription.patient.userId === caller.sub ||
    prescription.patient.guardianUserId === caller.sub ||
    prescription.prescribedById === caller.cpid;
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot issue a dispense code for this prescription');
  }
  if (prescription.status !== 'active') {
    throw conflict('PRESCRIPTION_NOT_ACTIVE', 'This prescription is not active');
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + env.DISPENSE_CODE_TTL_HOURS * 3_600_000);

  await prisma.dispenseCode.create({
    data: { prescriptionId, codeHash: sha256(code), expiresAt },
  });

  return { code, expires_at: expiresAt.toISOString(), prescription_id: prescriptionId };
}

/**
 * Redeems a code at the counter. Deliberately narrow output: items, dose and
 * prescriber — never the diagnosis. A pharmacist needs the medication, not
 * the condition; role-based access is the point.
 *
 * The conditional update (`redeemedAt: null`) is the single-use guarantee,
 * same pattern as OTP and the realtime ticket: a concurrent second redemption
 * loses the race and is told the code is already used, rather than both
 * succeeding.
 */
// Required, not optional: redemption always happens at a physical counter,
// and a code that could be redeemed with no pharmacy on record would leave
// the dispensing tied to nothing.
export async function verifyDispenseCode(code: string, pharmacyId: string, caller: Caller) {
  if (caller.role !== 'pharmacist' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a pharmacist may redeem a dispense code');
  }

  const row = await prisma.dispenseCode.findUnique({ where: { codeHash: sha256(code) } });
  if (!row) throw unauthenticated('DISPENSE_CODE_INVALID', 'Code is not valid');
  if (row.expiresAt < new Date()) throw unauthenticated('DISPENSE_CODE_EXPIRED', 'Code has expired');
  if (row.redeemedAt) throw unauthenticated('DISPENSE_CODE_INVALID', 'Code has already been used');

  const burned = await prisma.dispenseCode.updateMany({
    where: { id: row.id, redeemedAt: null },
    data: { redeemedAt: new Date(), pharmacyId },
  });
  if (burned.count !== 1) throw unauthenticated('DISPENSE_CODE_INVALID', 'Code has already been used');

  const prescription = await prisma.prescription.findUniqueOrThrow({
    where: { id: row.prescriptionId },
    include: {
      items: true,
      patient: { select: { fullName: true } },
      prescribedBy: { include: { user: { select: { fullName: true } } } },
    },
  });

  const dispensing = await prisma.dispensingRecord.create({
    data: {
      prescriptionId: prescription.id,
      pharmacyId,
      pharmacistUserId: caller.sub,
      status: 'pending',
    },
  });

  return {
    dispensing_id: dispensing.id,
    prescription_id: prescription.id,
    // No diagnosis field anywhere in this view — by omission, not by filtering.
    patient_display_name: prescription.patient.fullName,
    prescribed_by: prescription.prescribedBy.user.fullName ?? 'Unknown clinician',
    prescribed_at: prescription.createdAt.toISOString(),
    items: prescription.items.map((i) => ({
      id: i.id,
      medication_name: i.medicationName,
      dosage: i.dosage,
      frequency_per_day: i.frequencyPerDay,
      duration_days: i.durationDays,
      instructions: i.instructions,
    })),
  };
}

/**
 * Records what was actually handed over. Substitution requires pharmacist
 * review and a named approver — the platform never permits silent
 * substitution, enforced here rather than left as a UI convention.
 */
export async function completeDispensing(
  dispensingId: string,
  caller: Caller,
  items: { prescription_item_id: string; quantity_dispensed: number; substituted_with?: string; substitution_approved_by?: string }[],
) {
  const dispensing = await prisma.dispensingRecord.findUnique({ where: { id: dispensingId } });
  if (!dispensing) throw notFound('Dispensing record not found');
  if (dispensing.pharmacistUserId !== caller.sub && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'You did not open this dispensing');
  }
  if (dispensing.status === 'complete') {
    throw conflict('STATE_TRANSITION_INVALID', 'This dispensing is already complete');
  }

  for (const item of items) {
    if (item.substituted_with && !item.substitution_approved_by) {
      throw unprocessable(
        'A substitution requires an approving clinician',
        'items.substitution_approved_by',
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.dispensingItem.createMany({
      data: items.map((i) => ({
        dispensingId,
        prescriptionItemId: i.prescription_item_id,
        quantityDispensed: i.quantity_dispensed,
        substitutedWith: i.substituted_with ?? null,
        substitutionApprovedBy: i.substitution_approved_by ?? null,
      })),
    });

    const prescriptionItems = await tx.prescriptionItem.findMany({
      where: { prescriptionId: dispensing.prescriptionId },
    });
    const complete = items.length >= prescriptionItems.length;

    return tx.dispensingRecord.update({
      where: { id: dispensingId },
      data: { status: complete ? 'complete' : 'partial', dispensedAt: new Date(), version: { increment: 1 } },
    });
  });

  return {
    id: updated.id,
    prescription_id: updated.prescriptionId,
    status: updated.status,
    dispensed_at: updated.dispensedAt?.toISOString() ?? null,
    version: updated.version,
  };
}
