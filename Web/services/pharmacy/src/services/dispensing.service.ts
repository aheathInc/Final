import { randomBytes } from 'node:crypto';
import { prisma, type Prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, sha256, unauthenticated, unprocessable } from '@a-health/http';
import { env } from '../config/env.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

const DISPENSED_STATUSES = ['partial', 'complete'] as const;

function newReference(): string {
  // 256 bits of entropy; the plaintext is returned once and only its hash is stored.
  return randomBytes(32).toString('base64url');
}

async function loadPrescription(prescriptionId: string) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      items: true,
      patient: { select: { userId: true, guardianUserId: true, fullName: true } },
      prescribedBy: { include: { user: { select: { fullName: true, status: true } } } },
      consultation: { include: { note: true } },
    },
  });
  if (!prescription) throw notFound('Prescription not found');
  return prescription;
}

function assertPrescriptionEligible(prescription: Awaited<ReturnType<typeof loadPrescription>>) {
  if (prescription.status !== 'active') {
    throw conflict('PRESCRIPTION_NOT_ACTIVE', 'This prescription is not active');
  }
  if (!prescription.validUntil) {
    throw unprocessable('A clinician-specified validity date is required for pharmacy handoff', 'prescription.valid_until');
  }
  if (prescription.validUntil <= new Date()) {
    throw conflict('PRESCRIPTION_EXPIRED', 'This prescription has expired');
  }
  if (prescription.consultation.status !== 'completed' ||
      !prescription.consultation.note?.signedAt ||
      prescription.consultation.note.signedByClinicianId !== prescription.prescribedById) {
    throw conflict('PRESCRIPTION_NOT_FINALIZED', 'A completed consultation with its prescriber signature is required');
  }
  if (prescription.prescribedBy.verificationStatus !== 'verified' || prescription.prescribedBy.user.status !== 'active') {
    throw conflict('PRESCRIBER_NOT_AUTHORIZED', 'The issuing clinician is not currently authorized');
  }
  if (prescription.items.length === 0 || prescription.items.some((item) => !item.quantityPrescribed || item.quantityPrescribed < 1)) {
    throw unprocessable('Every medication must have a clinician-specified positive quantity', 'prescription.items.quantity_prescribed');
  }
}

async function assertPrescriptionOwner(
  prescription: { patientProfileId: string; prescribedById: string }, caller: Caller,
): Promise<void> {
  if (caller.cpid && caller.cpid === prescription.prescribedById) return;
  const patient = await prisma.patientProfile.findUnique({
    where: { id: prescription.patientProfileId },
    select: { userId: true, guardianUserId: true },
  });
  if (patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub)) return;
  throw forbidden('NOT_RESOURCE_OWNER', 'You cannot access this prescription');
}

async function requireVerifiedPharmacyMember(pharmacyId: string, caller: Caller) {
  if (caller.role !== 'pharmacist') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only an authorized pharmacist may handle prescription fulfilment');
  }
  const membership = await prisma.pharmacyMembership.findFirst({
    where: {
      userId: caller.sub,
      pharmacyId,
      isActive: true,
      isVerified: true,
      verifiedAt: { not: null },
      professionalLicenseNumber: { not: '' },
      user: { role: 'pharmacist', status: 'active' },
      pharmacy: { isActive: true, isVerified: true },
    },
    include: { pharmacy: { select: { id: true, name: true, facilityId: true, stock: true } } },
  });
  if (!membership) {
    throw forbidden('PHARMACY_MEMBERSHIP_REQUIRED', 'A verified active membership at this pharmacy is required');
  }
  return membership;
}

function remainingByItem(
  items: { id: string; quantityPrescribed: number | null }[],
  dispensed: { prescriptionItemId: string; quantityDispensed: number }[],
) {
  const totals = new Map<string, number>();
  for (const row of dispensed) totals.set(row.prescriptionItemId, (totals.get(row.prescriptionItemId) ?? 0) + row.quantityDispensed);
  return new Map(items.map((item) => [item.id, Math.max(0, (item.quantityPrescribed ?? 0) - (totals.get(item.id) ?? 0))]));
}

function audit(meta: Meta, actorUserId: string, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown>, transaction?: Prisma.TransactionClient) {
  return appendAudit({
    actorUserId, action, entityType, entityId, metadata,
    ipAddress: meta.ip, requestId: meta.requestId,
  }, transaction);
}

/** Returns only memberships which were explicitly verified by the controlled provisioning process. */
export async function listMyPharmacies(caller: Caller) {
  if (caller.role !== 'pharmacist') throw forbidden('ROLE_NOT_PERMITTED', 'Pharmacist access is required');
  const memberships = await prisma.pharmacyMembership.findMany({
    where: {
      userId: caller.sub, isActive: true, isVerified: true, verifiedAt: { not: null },
      professionalLicenseNumber: { not: '' },
      user: { role: 'pharmacist', status: 'active' },
      pharmacy: { isActive: true, isVerified: true },
    },
    include: { pharmacy: { select: { id: true, name: true, facilityId: true } } },
    orderBy: { pharmacy: { name: 'asc' } },
  });
  return { data: memberships.map(({ pharmacy }) => ({ id: pharmacy.id, name: pharmacy.name })) };
}

/** Patient/guardian requests a new opaque reference. Rotation revokes older references. */
export async function issueDispenseCode(prescriptionId: string, caller: Caller, meta: Meta) {
  const prescription = await loadPrescription(prescriptionId);
  await assertPrescriptionOwner(prescription, caller);
  assertPrescriptionEligible(prescription);

  const reference = newReference();
  const expiresAt = new Date(Date.now() + env.DISPENSE_CODE_TTL_HOURS * 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.dispenseCode.updateMany({
      where: { prescriptionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const created = await tx.dispenseCode.create({
      data: { prescriptionId, codeHash: sha256(reference), expiresAt },
    });
    const userId = prescription.patient.userId ?? prescription.patient.guardianUserId;
    if (userId) await tx.notificationLog.create({
      data: { userId, channel: 'sms', templateKey: 'prescription.handoff_ready', payload: {} as never },
    });
    await audit(meta, caller.sub, 'pharmacy.handoff.created', 'prescription_handoffs', created.id, { expires_at: expiresAt.toISOString() }, tx);
    return created;
  });
  return { reference, expires_at: expiresAt.toISOString() };
}

export async function revokeDispenseCode(prescriptionId: string, caller: Caller, meta: Meta) {
  const prescription = await loadPrescription(prescriptionId);
  await assertPrescriptionOwner(prescription, caller);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const revoked = await tx.dispenseCode.updateMany({
      where: { prescriptionId, revokedAt: null },
      data: { revokedAt: now },
    });
    await audit(meta, caller.sub, 'pharmacy.handoff.revoked', 'prescriptions', prescriptionId, { revoked_count: revoked.count }, tx);
    return revoked;
  });
  return { revoked: result.count > 0 };
}

/** Authenticated and verified pharmacy lookup. The reference never grants access by itself. */
export async function verifyDispenseCode(reference: string, pharmacyId: string, caller: Caller, meta: Meta) {
  try {
    const membership = await requireVerifiedPharmacyMember(pharmacyId, caller);
    const handoff = await prisma.dispenseCode.findUnique({ where: { codeHash: sha256(reference) } });
    if (!handoff) throw unauthenticated('HANDOFF_REFERENCE_INVALID', 'Reference is not valid');
    if (handoff.revokedAt) throw unauthenticated('HANDOFF_REFERENCE_REVOKED', 'Reference has been revoked');
    if (handoff.expiresAt <= new Date()) throw unauthenticated('HANDOFF_REFERENCE_EXPIRED', 'Reference has expired');

    const prescription = await loadPrescription(handoff.prescriptionId);
    assertPrescriptionEligible(prescription);
    const dispensedItems = await prisma.dispensingItem.findMany({
      where: { prescriptionItem: { prescriptionId: prescription.id }, dispensing: { status: { in: [...DISPENSED_STATUSES] } } },
      select: { prescriptionItemId: true, quantityDispensed: true },
    });
    const remaining = remainingByItem(prescription.items, dispensedItems);
    if ([...remaining.values()].every((quantity) => quantity === 0)) {
      throw conflict('PRESCRIPTION_ALREADY_FULFILLED', 'This prescription has no remaining quantity');
    }

    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.dispensingRecord.create({
        data: {
          prescriptionId: prescription.id,
          pharmacyId: membership.pharmacy.id,
          pharmacistUserId: caller.sub,
          handoffId: handoff.id,
          status: 'pending',
        },
      });
      await audit(meta, caller.sub, 'pharmacy.handoff.verified', 'prescription_handoffs', handoff.id, { pharmacy_id: membership.pharmacy.id }, tx);
      await audit(meta, caller.sub, 'pharmacy.dispensing.started', 'dispensing_records', created.id, { pharmacy_id: membership.pharmacy.id }, tx);
      return created;
    });
    return {
      dispensing_id: record.id,
      prescription_id: prescription.id,
      prescription_status: prescription.status,
      valid_until: prescription.validUntil!.toISOString(),
      patient_display_name: prescription.patient.fullName,
      prescribed_by: prescription.prescribedBy.user.fullName ?? 'Verified clinician',
      prescribed_at: prescription.createdAt.toISOString(),
      pharmacy: { id: membership.pharmacy.id, name: membership.pharmacy.name },
      items: prescription.items.map((item) => {
        const stock = membership.pharmacy.stock.find((row) => row.medicationName.toLowerCase() === item.medicationName.toLowerCase());
        return {
          id: item.id,
          medication_name: item.medicationName,
          dosage: item.dosage,
          frequency_per_day: item.frequencyPerDay,
          duration_days: item.durationDays,
          instructions: item.instructions,
          quantity_prescribed: item.quantityPrescribed,
          quantity_dispensed: (item.quantityPrescribed ?? 0) - (remaining.get(item.id) ?? 0),
          quantity_remaining: remaining.get(item.id) ?? 0,
          quantity_on_hand: stock?.stockStatus === 'out_of_stock' ? 0 : stock?.quantityOnHand ?? null,
          inventory_status: stock?.stockStatus ?? 'unknown',
        };
      }),
    };
  } catch (error) {
    const reason = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' ? error.code : 'verification_failed';
    await audit(meta, caller.sub, 'pharmacy.handoff.verification_rejected', 'pharmacy_handoff_attempts', null, { reason_code: reason }).catch(() => undefined);
    throw error;
  }
}

export async function completeDispensing(
  dispensingId: string,
  caller: Caller,
  input: { idempotency_key: string; items: { prescription_item_id: string; quantity_dispensed: number }[] },
  meta: Meta,
) {
  const canonicalItems = [...input.items].sort((a, b) => a.prescription_item_id.localeCompare(b.prescription_item_id));
  const requestHash = sha256(JSON.stringify(canonicalItems));
  const record = await prisma.dispensingRecord.findUnique({ where: { id: dispensingId } });
  if (!record) throw notFound('Dispensing record not found');
  try {
    await requireVerifiedPharmacyMember(record.pharmacyId, caller);
  } catch (error) {
    await audit(meta, caller.sub, 'pharmacy.dispensing.rejected', 'dispensing_records', record.id, { reason_code: error instanceof Error && 'code' in error ? String(error.code) : 'authorization_failed' }).catch(() => undefined);
    throw error;
  }
  if (record.pharmacistUserId !== caller.sub) {
    await audit(meta, caller.sub, 'pharmacy.dispensing.rejected', 'dispensing_records', record.id, { reason_code: 'NOT_RESOURCE_OWNER' }).catch(() => undefined);
    throw forbidden('NOT_RESOURCE_OWNER', 'This dispensing session belongs to another pharmacist');
  }

  const replay = await prisma.dispensingRecord.findUnique({
    where: { idempotencyKey: input.idempotency_key }, include: { items: true },
  });
  if (replay) {
    if (replay.id !== dispensingId || replay.pharmacistUserId !== caller.sub || replay.idempotencyRequestHash !== requestHash) {
      await audit(meta, caller.sub, 'pharmacy.dispensing.rejected', 'dispensing_records', record.id, { reason_code: 'IDEMPOTENCY_KEY_REUSED' }).catch(() => undefined);
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different dispensing request');
    }
    return serializeDispensing(replay);
  }
  if (record.status !== 'pending') {
    await audit(meta, caller.sub, 'pharmacy.dispensing.rejected', 'dispensing_records', record.id, { reason_code: 'DISPENSING_ALREADY_RECORDED' }).catch(() => undefined);
    throw conflict('DISPENSING_ALREADY_RECORDED', 'This dispensing session has already been recorded');
  }
  if (new Set(canonicalItems.map((item) => item.prescription_item_id)).size !== canonicalItems.length) {
    throw unprocessable('A prescription item may appear only once in a dispensing event', 'items');
  }

  const transaction = prisma.$transaction(async (tx) => {
    // All attempts for one prescription serialize here. The availability update
    // below also has a conditional quantity guard for cross-prescription races.
    await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "prescriptions" WHERE id = ${record.prescriptionId}::uuid FOR UPDATE`;

    const current = await tx.dispensingRecord.findUnique({
      where: { id: dispensingId }, include: { handoff: true },
    });
    if (!current || current.status !== 'pending' || current.pharmacistUserId !== caller.sub) {
      throw conflict('DISPENSING_ALREADY_RECORDED', 'This dispensing session is no longer pending');
    }
    if (!current.handoff || current.handoff.revokedAt || current.handoff.expiresAt <= new Date()) {
      throw conflict('HANDOFF_REFERENCE_REVOKED', 'The prescription handoff is no longer valid');
    }

    const prescription = await tx.prescription.findUnique({
      where: { id: current.prescriptionId },
      include: {
        items: true,
        prescribedBy: { include: { user: { select: { status: true, fullName: true } } } },
        consultation: { include: { note: true } },
      },
    });
    if (!prescription) throw notFound('Prescription not found');
    assertPrescriptionEligible({ ...prescription, patient: { userId: null, guardianUserId: null, fullName: '' } });

    const knownItems = new Map(prescription.items.map((item) => [item.id, item]));
    for (const inputItem of canonicalItems) {
      const prescribed = knownItems.get(inputItem.prescription_item_id);
      if (!prescribed) throw unprocessable('The item does not belong to this prescription', 'items.prescription_item_id');
      if (!Number.isSafeInteger(inputItem.quantity_dispensed) || inputItem.quantity_dispensed < 1) {
        throw unprocessable('Dispensed quantity must be a positive whole number', 'items.quantity_dispensed');
      }
    }

    const prior = await tx.dispensingItem.findMany({
      where: { prescriptionItem: { prescriptionId: prescription.id }, dispensing: { status: { in: [...DISPENSED_STATUSES] } } },
      select: { prescriptionItemId: true, quantityDispensed: true },
    });
    const remaining = remainingByItem(prescription.items, prior);
    for (const item of canonicalItems) {
      const left = remaining.get(item.prescription_item_id) ?? 0;
      if (item.quantity_dispensed > left) throw conflict('QUANTITY_EXCEEDS_REMAINING', 'The requested quantity exceeds the prescription remainder');
    }

    const pharmacy = await tx.pharmacy.findFirst({
      where: { id: current.pharmacyId, isActive: true, isVerified: true,
        memberships: { some: { userId: caller.sub, isActive: true, isVerified: true, verifiedAt: { not: null }, professionalLicenseNumber: { not: '' } } } },
    });
    if (!pharmacy) throw forbidden('PHARMACY_MEMBERSHIP_REQUIRED', 'Verified pharmacy membership is required');

    const createdItems: { prescriptionItemId: string; quantityDispensed: number; pharmacyStockId: string }[] = [];
    for (const requested of canonicalItems) {
      const prescribedItem = knownItems.get(requested.prescription_item_id)!;
      const stockRows = await tx.pharmacyStock.findMany({
        where: { pharmacyId: current.pharmacyId, medicationName: { equals: prescribedItem.medicationName, mode: 'insensitive' } },
        orderBy: { id: 'asc' },
      });
      if (stockRows.length !== 1) {
        throw conflict(stockRows.length ? 'INVENTORY_AMBIGUOUS' : 'INVENTORY_UNAVAILABLE', 'A single confirmed inventory record is required');
      }
      const stock = stockRows[0]!;
      if (stock.stockStatus === 'out_of_stock' || stock.quantityOnHand === null || stock.quantityOnHand < requested.quantity_dispensed) {
        throw conflict('INSUFFICIENT_INVENTORY', 'The pharmacy does not have the requested confirmed quantity');
      }
      const updated = await tx.pharmacyStock.updateMany({
        where: { id: stock.id, pharmacyId: current.pharmacyId, quantityOnHand: { gte: requested.quantity_dispensed } },
        data: {
          quantityOnHand: { decrement: requested.quantity_dispensed },
          ...(stock.quantityOnHand === requested.quantity_dispensed ? { stockStatus: 'out_of_stock' as const } : {}),
          lastReportedAt: new Date(), version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw conflict('INSUFFICIENT_INVENTORY', 'Stock changed before dispensing could be recorded');
      createdItems.push({ prescriptionItemId: requested.prescription_item_id, quantityDispensed: requested.quantity_dispensed, pharmacyStockId: stock.id });
    }

    await tx.dispensingItem.createMany({
      data: createdItems.map((item) => ({
        dispensingId, prescriptionItemId: item.prescriptionItemId,
        quantityDispensed: item.quantityDispensed, pharmacyStockId: item.pharmacyStockId,
      })),
    });

    const fulfilled = prescription.items.every((item) => {
      const after = (item.quantityPrescribed ?? 0) - (remaining.get(item.id) ?? 0) +
        (createdItems.find((row) => row.prescriptionItemId === item.id)?.quantityDispensed ?? 0);
      return after >= (item.quantityPrescribed ?? 0);
    });
    const updated = await tx.dispensingRecord.update({
      where: { id: dispensingId },
      data: {
        status: fulfilled ? 'complete' : 'partial', dispensedAt: new Date(),
        idempotencyKey: input.idempotency_key, idempotencyRequestHash: requestHash,
        version: { increment: 1 },
      },
      include: { items: true },
    });
    if (fulfilled) {
      await tx.prescription.update({ where: { id: prescription.id }, data: { status: 'completed', version: { increment: 1 } } });
    }

    const patient = await tx.patientProfile.findUnique({ where: { id: prescription.patientProfileId }, select: { userId: true, guardianUserId: true } });
    const userId = patient?.userId ?? patient?.guardianUserId;
    if (userId) {
      await tx.notificationLog.create({
        data: { userId, channel: 'sms', templateKey: 'prescription.fulfilment_update', payload: {} as never },
      });
    }
    await audit(meta, caller.sub, updated.status === 'complete' ? 'pharmacy.dispensing.completed' : 'pharmacy.dispensing.partial',
      'dispensing_records', updated.id, { pharmacy_id: current.pharmacyId, item_count: input.items.length }, tx);
    return { updated, prescriptionId: prescription.id, pharmacyId: current.pharmacyId, fulfilled };
  });
  let completed: Awaited<typeof transaction>;
  try {
    completed = await transaction;
  } catch (error) {
    const reason = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' ? error.code : 'dispensing_failed';
    await audit(meta, caller.sub, 'pharmacy.dispensing.rejected', 'dispensing_records', record.id, { reason_code: reason }).catch(() => undefined);
    throw error;
  }
  return serializeDispensing(completed.updated);
}

function serializeDispensing(record: { id: string; prescriptionId: string; status: string; dispensedAt: Date | null; version: number; items?: { prescriptionItemId: string; quantityDispensed: number }[] }) {
  return {
    id: record.id,
    prescription_id: record.prescriptionId,
    status: record.status,
    dispensed_at: record.dispensedAt?.toISOString() ?? null,
    version: record.version,
    items: (record.items ?? []).map((item) => ({ prescription_item_id: item.prescriptionItemId, quantity_dispensed: item.quantityDispensed })),
  };
}

/** Patient-owned read-back: availability is advisory, history is persisted fulfilment only. */
export async function getPrescriptionFulfillment(prescriptionId: string, caller: Caller) {
  const prescription = await loadPrescription(prescriptionId);
  await assertPrescriptionOwner(prescription, caller);
  const [dispensedItems, records, prescribingClinician] = await Promise.all([
    prisma.dispensingItem.findMany({
      where: { prescriptionItem: { prescriptionId }, dispensing: { status: { in: [...DISPENSED_STATUSES] } } },
      select: { prescriptionItemId: true, quantityDispensed: true },
    }),
    prisma.dispensingRecord.findMany({
      where: { prescriptionId, status: { in: [...DISPENSED_STATUSES] } },
      include: { pharmacy: { select: { id: true, name: true, isVerified: true } }, items: { include: { prescriptionItem: { select: { id: true, medicationName: true } } } } },
      orderBy: { dispensedAt: 'asc' },
    }),
    prisma.clinicianProfile.findUnique({ where: { id: prescription.prescribedById }, select: { facilityId: true } }),
  ]);
  const remaining = remainingByItem(prescription.items, dispensedItems);
  const facilityPharmacy = prescribingClinician?.facilityId
    ? await prisma.pharmacy.findFirst({ where: { facilityId: prescribingClinician.facilityId, isActive: true, isVerified: true }, include: { stock: true } })
    : null;
  const quantitiesKnown = prescription.items.length > 0 &&
    prescription.items.every((item) => item.quantityPrescribed != null && item.quantityPrescribed > 0);
  const everyItemComplete = quantitiesKnown &&
    prescription.items.every((item) => (remaining.get(item.id) ?? 0) === 0);
  const expired = prescription.validUntil != null && prescription.validUntil <= new Date();
  const fulfilmentStatus = everyItemComplete
    ? 'complete'
    : prescription.status === 'discontinued'
      ? 'cancelled'
      : !quantitiesKnown
        ? 'quantity_unspecified'
        : !prescription.validUntil
          ? 'validity_unspecified'
          : expired
            ? 'expired'
            : dispensedItems.length
              ? 'partial'
              : 'not_dispensed';

  return {
    prescription_id: prescription.id,
    status: prescription.status,
    fulfilment_status: fulfilmentStatus,
    valid_until: prescription.validUntil?.toISOString() ?? null,
    facility_pharmacy: facilityPharmacy ? {
      id: facilityPharmacy.id, name: facilityPharmacy.name,
      items: prescription.items.map((item) => {
        const quantityRemaining = item.quantityPrescribed == null
          ? null
          : remaining.get(item.id) ?? item.quantityPrescribed;
        const stock = facilityPharmacy.stock.find((row) => row.medicationName.toLowerCase() === item.medicationName.toLowerCase());
        const quantityOnHand = stock?.stockStatus === 'out_of_stock' ? 0 : stock?.quantityOnHand ?? null;
        const availability = item.quantityPrescribed == null || quantityOnHand === null ? 'unknown'
          : quantityOnHand <= 0 || stock?.stockStatus === 'out_of_stock' ? 'unavailable'
          : quantityOnHand < (quantityRemaining ?? 0) ? 'partially_available' : 'available';
        return { prescription_item_id: item.id, medication_name: item.medicationName, quantity_remaining: quantityRemaining, quantity_on_hand: quantityOnHand, availability, last_reported_at: stock?.lastReportedAt.toISOString() ?? null };
      }),
    } : null,
    items: prescription.items.map((item) => {
      const dispensed = dispensedItems
        .filter((row) => row.prescriptionItemId === item.id)
        .reduce((total, row) => total + row.quantityDispensed, 0);
      const quantityRemaining = item.quantityPrescribed == null
        ? null
        : remaining.get(item.id) ?? item.quantityPrescribed;
      return {
        id: item.id, medication_name: item.medicationName, dosage: item.dosage,
        frequency_per_day: item.frequencyPerDay, duration_days: item.durationDays,
        quantity_prescribed: item.quantityPrescribed,
        quantity_dispensed: dispensed,
        quantity_remaining: quantityRemaining,
        status: item.quantityPrescribed == null
          ? 'quantity_unspecified'
          : quantityRemaining === 0
            ? 'dispensed'
            : dispensed === 0
              ? 'not_dispensed'
              : 'partially_dispensed',
      };
    }),
    dispensing_history: records.map((record) => ({
      dispensing_id: record.id, pharmacy: record.pharmacy,
      dispensed_at: record.dispensedAt?.toISOString() ?? null,
      status: record.status,
      items: record.items.map((item) => ({ prescription_item_id: item.prescriptionItemId, medication_name: item.prescriptionItem.medicationName, quantity_dispensed: item.quantityDispensed })),
    })),
  };
}
