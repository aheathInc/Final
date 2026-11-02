import { randomUUID } from 'node:crypto';
import type { Prisma } from '@a-health/database';
import { appendAudit } from '@a-health/http';
import { isFreeConsultation } from '@a-health/database/consultation-billing';

export const feePolicyVersion = 'remote-tzs-v1';
export const remoteFee = (specialty: string) => specialty === 'general_practice' ? 5000 : 8000;

/** Bill only after the clinician is known; a bill is not a wallet charge. */
export async function billAcceptedConsultation(tx: Prisma.TransactionClient, consultationId: string, clinicianId: string) {
  const c = await tx.consultationRequest.findUniqueOrThrow({ where: { id: consultationId }, include: { patient: true } });
  if (isFreeConsultation(c) || c.consultationMode !== 'remote' || c.feePolicyVersion !== feePolicyVersion) return;
  const clinician = await tx.clinicianProfile.findUniqueOrThrow({ where: { id: clinicianId } });
  const amount = c.consultationFeeAmount ?? remoteFee(clinician.specialty);
  const payer = c.patient.userId ?? c.patient.guardianUserId;
  if (!payer) throw new Error('A remote consultation requires a registered payer.');
  await tx.consultationRequest.update({ where: { id: c.id }, data: { consultationFeeAmount: amount } });
  const bill = await tx.careBill.upsert({
    where: { consultationId: c.id }, update: {},
    create: { reference: `AHP-${randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`,
      payerUserId: payer, issuedById: clinician.userId, patientProfileId: c.patientProfileId, consultationId: c.id,
      title: 'Remote consultation', amount, currency: 'TZS', purpose: 'consultation_fee', expiresAt: new Date(Date.now() + 7 * 86400_000) },
  });
  await appendAudit({ actorUserId: clinician.userId, action: 'payment.bill_issued', entityType: 'care_bills', entityId: bill.id,
    metadata: { consultationId: c.id, amount, currency: 'TZS', feePolicyVersion } }, tx);
}
