import { createHash } from 'node:crypto';
import { prisma, type Prisma } from './client.js';

export const enrollmentHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function findEnrollment(token: string, db: Prisma.TransactionClient = prisma) {
  if (!/^enr_[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const record = await db.patientEnrollment.findUnique({
    where: { tokenHash: enrollmentHash(token) },
    include: { user: { include: { patientProfile: true } }, bill: true },
  });
  if (!record || record.completedAt || record.expiresAt <= new Date() ||
      record.user.role !== 'patient' || !record.user.onboardingRequired ||
      record.user.status !== 'pending_verification') return null;
  return record;
}
