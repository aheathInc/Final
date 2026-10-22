import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';
const log = createLogger('followup.care-reminders');

/** Persist in-app reminders and opt-in SMS requests; never infer a missed dose. */
export async function reminderTick(now = new Date()) {
  const cutoff = new Date(now.getTime() - env.CARE_REMINDER_WINDOW_MINUTES * 60_000);
  const doses = await prisma.adherenceLog.findMany({ where: {
    supersededAt: null, reportedStatus: 'unreported', scheduledAt: { gte: cutoff, lte: now },
    reminderPlan: { is: { status: 'active' } }, prescription: { status: { not: 'discontinued' } }, careReminder: { is: null },
  }, select: { id: true }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: env.CARE_REMINDER_BATCH });
  const checkins = await prisma.checkIn.findMany({ where: { status: 'scheduled', scheduledAt: { gte: cutoff, lte: now },
    followUpCycle: { status: 'active' }, careReminder: { is: null },
  }, select: { id: true }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: env.CARE_REMINDER_BATCH });
  let created = 0, smsQueued = 0;
  for (const subject of [...doses.map(d => ({ kind: 'dose' as const, id: d.id })), ...checkins.map(c => ({ kind: 'checkin' as const, id: c.id }))]) {
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`care-reminder:${subject.kind}:${subject.id}`}, 0))`;
      let profileId: string, due: Date;
      if (subject.kind === 'dose') {
        const dose = await tx.adherenceLog.findUnique({ where: { id: subject.id }, include: { reminderPlan: true, prescription: true, careReminder: true } });
        if (!dose || dose.careReminder || dose.supersededAt || dose.reportedStatus !== 'unreported' || dose.reminderPlan?.status !== 'active' || dose.prescription.status === 'discontinued') return null;
        profileId = dose.patientProfileId; due = dose.scheduledAt;
      } else {
        const check = await tx.checkIn.findUnique({ where: { id: subject.id }, include: { followUpCycle: true, careReminder: true } });
        if (!check || check.careReminder || check.status !== 'scheduled' || check.followUpCycle.status !== 'active') return null;
        profileId = check.followUpCycle.patientProfileId; due = check.scheduledAt;
      }
      if (due > now || due < cutoff) return null;
      const profile = await tx.patientProfile.findUniqueOrThrow({ where: { id: profileId }, include: { reminderPreferences: true } });
      const recipientId = profile.userId ?? profile.guardianUserId;
      const recipient = recipientId ? await tx.user.findUnique({ where: { id: recipientId }, select: { id: true, status: true } }) : null;
      // Defaults to in-app only. SMS opt-in is always explicit and per profile.
      const sms = profile.reminderPreferences?.smsEnabled === true && recipient?.status === 'active';
      const notification = sms ? await tx.notificationLog.create({ data: {
        userId: recipient!.id, channel: 'sms', templateKey: subject.kind === 'dose' ? 'care.dose_due' : 'care.checkin_due',
        payload: {}, deliverAfter: now, dedupeKey: `care:${subject.kind}:${subject.id}`,
      } }) : null;
      await tx.careReminder.create({ data: { patientProfileId: profileId,
        ...(subject.kind === 'dose' ? { adherenceLogId: subject.id } : { checkInId: subject.id }),
        notificationId: notification?.id ?? null, dueAt: due,
        expiresAt: new Date(due.getTime() + env.CARE_REMINDER_WINDOW_MINUTES * 60_000),
      } });
      return { sms };
    }, { maxWait: 10_000, timeout: 10_000 });
    if (result) { created++; if (result.sms) smsQueued++; }
  }
  return { created, smsQueued };
}
export function startCareReminderWorker() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { const result = await reminderTick(); if (result.created) log.info('care reminders queued', result); }
    catch { log.error('care reminder tick failed', { code: 'CARE_REMINDER_TICK_FAILED' }); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void run(); }, env.CARE_REMINDER_INTERVAL_SECONDS * 1000);
  timer.unref(); void run(); return timer;
}
