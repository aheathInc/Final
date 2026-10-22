import { prisma } from '@a-health/database';
/** Recheck immediately before sending; never disclose an old or answered reminder. */
export async function careDeliveryAllowed(notificationId: string, userId: string, now: Date): Promise<boolean> {
  const row = await prisma.careReminder.findUnique({ where: { notificationId }, include: {
    patient: { include: { reminderPreferences: true } },
    dose: { include: { reminderPlan: true, prescription: true } }, checkIn: { include: { followUpCycle: true } },
  } });
  if (!row || row.expiresAt <= now || row.dueAt > now || row.readAt || !row.patient.reminderPreferences?.smsEnabled) return false;
  if ((row.patient.userId ?? row.patient.guardianUserId) !== userId) return false;
  if (row.dose) return !row.dose.supersededAt && row.dose.reportedStatus === 'unreported' &&
    row.dose.reminderPlan?.status === 'active' && row.dose.prescription.status !== 'discontinued';
  return !!row.checkIn && row.checkIn.status === 'scheduled' && row.checkIn.followUpCycle.status === 'active';
}
