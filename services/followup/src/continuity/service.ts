import { prisma, type Prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, unprocessable } from '@a-health/http';
import { buildSchedule, doseState, ScheduleError, type ScheduleInput } from './schedule.js';

export interface Caller { sub: string; role: string; cpid?: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }
const options = { maxWait: 10_000, timeout: 15_000 };
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const own = (sub: string) => ({ OR: [{ userId: sub }, { guardianUserId: sub }] });
const planJson = (p: { id: string; prescriptionItemId: string; timezone: string; startDate: Date; times: unknown; status: string; version: number }) => ({
  id: p.id, prescription_item_id: p.prescriptionItemId, timezone: p.timezone,
  start_date: p.startDate.toISOString().slice(0, 10), times: p.times, status: p.status, version: p.version,
});
const contactJson = (c: { id: string; followUpCycleId: string; scheduledAt: Date; channel: string; purpose: string; status: string; note: string | null; completedAt: Date | null; version: number }, patient = false) => ({
  id: c.id, follow_up_cycle_id: c.followUpCycleId, scheduled_at: iso(c.scheduledAt), channel: c.channel,
  purpose: c.purpose, status: c.status, completed_at: iso(c.completedAt), version: c.version,
  // Private clinician contact notes are not automatically patient-facing.
  ...(patient ? {} : { note: c.note }),
});
async function clinician(caller: Caller, db: Prisma.TransactionClient = prisma) {
  if (caller.role !== 'clinician' || !caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'A clinician account is required.');
  const row = await db.clinicianProfile.findFirst({ where: { id: caller.cpid, userId: caller.sub,
    verificationStatus: 'verified', user: { status: 'active' } }, select: { id: true } });
  if (!row) throw forbidden('CLINICIAN_NOT_VERIFIED', 'Verified active clinician required.');
  return row.id;
}
async function patient(patientId: string | undefined, caller: Caller, db: Prisma.TransactionClient = prisma) {
  if (caller.role !== 'patient') throw forbidden('ROLE_NOT_PERMITTED', 'Patient account required.');
  const rows = await db.patientProfile.findMany({ where: own(caller.sub),
    select: { id: true, fullName: true, userId: true, guardianUserId: true }, orderBy: { id: 'asc' } });
  const selected = patientId ? rows.find(row => row.id === patientId) : rows.find(row => row.userId === caller.sub) ?? rows[0];
  if (patientId && !selected) throw forbidden('NOT_RESOURCE_OWNER', 'This patient record is not yours.');
  if (!selected) throw notFound('Patient profile not found.');
  return { selected, rows };
}
async function cycleForClinician(id: string, caller: Caller, db: Prisma.TransactionClient = prisma) {
  const clinicianId = await clinician(caller, db);
  const row = await db.followUpCycle.findUnique({ where: { id }, include: { patient: {
    select: { fullName: true, user: { select: { phoneNumber: true } }, guardian: { select: { phoneNumber: true } } },
  } } });
  if (!row) throw notFound('Follow-up cycle not found.');
  if (row.clinicianId !== clinicianId) throw forbidden('NOT_RESOURCE_OWNER', 'Only the assigned follow-up clinician can open this record.');
  return row;
}
async function itemLock(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`care-plan:${id}`}, 0))`;
}
async function audit(tx: Prisma.TransactionClient, caller: Caller, meta: Meta, action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  await appendAudit({ actorUserId: caller.sub, action, entityType, entityId, metadata,
    ipAddress: meta.ip, requestId: meta.requestId }, tx);
}

/** Explicit times only; frequency/duration/dose are read from the signed prescription. */
export async function saveSchedule(itemId: string, caller: Caller, input: ScheduleInput & { base_version: number }, meta: Meta, now = new Date()) {
  return prisma.$transaction(async tx => {
    const clinicianId = await clinician(caller, tx);
    await itemLock(tx, itemId);
    const item = await tx.prescriptionItem.findUnique({ where: { id: itemId }, include: { prescription: {
      include: { consultation: { include: { note: true } } },
    }, reminderPlan: true } });
    if (!item) throw notFound('Prescription item not found.');
    const prescription = item.prescription;
    if (prescription.prescribedById !== clinicianId) throw forbidden('NOT_RESOURCE_OWNER', 'The prescribing clinician must confirm reminder times.');
    if (prescription.status === 'discontinued' || prescription.consultation.status !== 'completed' ||
      !prescription.consultation.note?.signedAt || prescription.consultation.note.signedByClinicianId !== clinicianId) {
      throw conflict('PRESCRIPTION_NOT_FINALIZED', 'A signed, non-discontinued prescription is required.');
    }
    const existing = item.reminderPlan;
    if ((existing?.version ?? 0) !== input.base_version) throw conflict('VERSION_CONFLICT', 'Reload the reminder schedule before editing.');
    if (existing?.status === 'cancelled') throw conflict('STATE_TRANSITION_INVALID', 'A cancelled schedule cannot be reopened; clinical review is required.');
    // Replacing an already used treatment schedule could duplicate reported doses.
    const reports = await tx.adherenceLog.count({ where: { prescriptionItemId: itemId, reportedStatus: { not: 'unreported' } } });
    if (reports > 0) throw conflict('STATE_TRANSITION_INVALID', 'Dose reports already exist. Timing changes require a reviewed replacement prescription.');
    let dates: Date[];
    try { dates = buildSchedule(input, item.frequencyPerDay, item.durationDays, now); }
    catch (error) { if (error instanceof ScheduleError) throw unprocessable(error.message); throw error; }
    // Idempotency middleware protects retries; optimistic version protects competing edits.
    const plan = await tx.medicationReminderPlan.upsert({ where: { prescriptionItemId: itemId },
      create: { prescriptionItemId: itemId, timezone: input.timezone, startDate: new Date(`${input.start_date}T00:00:00Z`),
        times: [...input.times].sort(), configuredById: clinicianId, configuredAt: now },
      update: { timezone: input.timezone, startDate: new Date(`${input.start_date}T00:00:00Z`), times: [...input.times].sort(),
        status: 'active', configuredById: clinicianId, configuredAt: now, version: { increment: 1 } },
    });
    // Keep history; old inferred/unreported slots must not remain actionable.
    await tx.adherenceLog.updateMany({ where: { prescriptionItemId: itemId, reportedStatus: 'unreported', supersededAt: null },
      data: { supersededAt: now, version: { increment: 1 } } });
    await tx.adherenceLog.createMany({ data: dates.map(scheduledAt => ({
      prescriptionItemId: itemId, prescriptionId: prescription.id, patientProfileId: prescription.patientProfileId,
      medicationName: item.medicationName, dosage: item.dosage, reminderPlanId: plan.id, scheduledAt,
    })) });
    await audit(tx, caller, meta, 'care.schedule_configured', 'medication_reminder_plans', plan.id,
      { prescriptionItemId: itemId, slotCount: dates.length, version: plan.version });
    return { ...planJson(plan), dose_count: dates.length };
  }, options);
}
export async function changePlanState(id: string, caller: Caller, input: { base_version: number; status: string }, meta: Meta) {
  return prisma.$transaction(async tx => {
    const clinicianId = await clinician(caller, tx);
    const plan = await tx.medicationReminderPlan.findUnique({ where: { id }, include: { item: { include: { prescription: true } } } });
    if (!plan) throw notFound();
    await itemLock(tx, plan.prescriptionItemId);
    if (plan.item.prescription.prescribedById !== clinicianId) throw forbidden('NOT_RESOURCE_OWNER', 'Prescriber required.');
    const updated = await tx.medicationReminderPlan.updateMany({ where: { id, version: input.base_version, status: { not: 'cancelled' } },
      data: { status: input.status, version: { increment: 1 } } });
    if (!updated.count) throw conflict('VERSION_CONFLICT', 'Reload the schedule; it changed or was cancelled.');
    if (input.status === 'cancelled') await tx.adherenceLog.updateMany({ where: { reminderPlanId: id, supersededAt: null, reportedStatus: 'unreported' },
      data: { supersededAt: new Date(), version: { increment: 1 } } });
    await audit(tx, caller, meta, 'care.schedule_state_changed', 'medication_reminder_plans', id, { status: input.status });
    return planJson(await tx.medicationReminderPlan.findUniqueOrThrow({ where: { id } }));
  }, options);
}
export async function updatePreference(caller: Caller, patientId: string, input: { base_version: number; sms_enabled: boolean }, meta: Meta) {
  return prisma.$transaction(async tx => {
    await patient(patientId, caller, tx);
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`care-preference:${patientId}`}, 0))`;
    const prior = await tx.careReminderPreference.findUnique({ where: { patientProfileId: patientId } });
    if ((prior?.version ?? 0) !== input.base_version) throw conflict('VERSION_CONFLICT', 'Reload reminder preferences.');
    const row = await tx.careReminderPreference.upsert({ where: { patientProfileId: patientId },
      create: { patientProfileId: patientId, smsEnabled: input.sms_enabled, updatedById: caller.sub },
      update: { smsEnabled: input.sms_enabled, updatedById: caller.sub, version: { increment: 1 } } });
    await audit(tx, caller, meta, 'care.reminder_preference_changed', 'care_reminder_preferences', row.id, { smsEnabled: row.smsEnabled });
    return { patient_profile_id: patientId, sms_enabled: row.smsEnabled, version: row.version };
  }, options);
}
export async function patientOverview(caller: Caller, query: { patient_profile_id?: string; cursor?: string; limit: number }, now = new Date()) {
  const { selected, rows } = await patient(query.patient_profile_id, caller);
  const profileId = selected.id;
  const from = new Date(now.getTime() - 7 * 86_400_000), to = new Date(now.getTime() + 7 * 86_400_000);
  const [doses, cycles, preferences, reminders, items] = await Promise.all([
    prisma.adherenceLog.findMany({ where: { patientProfileId: profileId, supersededAt: null, scheduledAt: { gte: from, lte: to },
      prescription: { status: { not: 'discontinued' } } }, include: { reminderPlan: true },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) }),
    prisma.followUpCycle.findMany({ where: { patientProfileId: profileId, status: 'active' }, take: 51,
      orderBy: { endDate: 'asc' }, include: { contacts: { orderBy: { scheduledAt: 'asc' }, take: 20 },
        checkIns: { where: { status: { in: ['scheduled', 'missed'] }, scheduledAt: { lte: now } }, orderBy: { scheduledAt: 'asc' }, take: 20 } } }),
    prisma.careReminderPreference.findUnique({ where: { patientProfileId: profileId } }),
    prisma.careReminder.findMany({ where: { patientProfileId: profileId, dueAt: { gte: from } }, include: { notification: true },
      orderBy: { dueAt: 'desc' }, take: 50 }),
    prisma.prescriptionItem.findMany({ where: { prescription: { patientProfileId: profileId, status: { not: 'discontinued' } } },
      include: { reminderPlan: true }, orderBy: { createdAt: 'desc' }, take: 51 }),
  ]);
  const data = doses.slice(0, query.limit);
  return {
    patient: { id: profileId, full_name: selected.fullName }, profiles: rows.map(p => ({ id: p.id, full_name: p.fullName })),
    as_of: iso(now), window: { from: iso(from), to: iso(to) },
    doses: data.map(d => ({ id: d.id, prescription_id: d.prescriptionId, prescription_item_id: d.prescriptionItemId,
      medication_name: d.medicationName, dosage: d.dosage, scheduled_at: iso(d.scheduledAt),
      reported_status: d.reportedStatus, reported_at: iso(d.reportedAt), state: doseState(d.reportedStatus, d.scheduledAt, now),
      version: d.version, schedule_status: d.reminderPlan?.status ?? 'timing_not_confirmed',
      timezone: d.reminderPlan?.timezone ?? null })),
    meta: { has_more: doses.length > query.limit, next_cursor: doses.length > query.limit ? data.at(-1)?.id ?? null : null },
    preference: { sms_enabled: preferences?.smsEnabled ?? false, version: preferences?.version ?? 0 },
    plans: items.slice(0, 50).map(i => ({ prescription_item_id: i.id, medication_name: i.medicationName,
      dosage: i.dosage, plan: i.reminderPlan ? planJson(i.reminderPlan) : null })), plans_truncated: items.length > 50,
    cycles: cycles.slice(0, 50).map(c => ({ id: c.id, care_thread_id: c.careThreadId, status: c.status,
      end_date: iso(c.endDate), review_due: c.endDate < now, outcome: c.outcome,
      contacts: c.contacts.map(row => contactJson(row, true)),
      checkins: c.checkIns.map(row => ({ id: row.id, scheduled_at: iso(row.scheduledAt), status: row.status })) })),
    cycles_truncated: cycles.length > 50,
    reminders: reminders.map(r => ({ id: r.id, adherence_log_id: r.adherenceLogId, check_in_id: r.checkInId,
      due_at: iso(r.dueAt), read_at: iso(r.readAt), expires_at: iso(r.expiresAt),
      delivery: !r.notification ? 'in_app_only' : r.notification.providerRef?.startsWith('console-') ? 'simulated' :
        r.notification.failureCode === 'SUPERSEDED_CARE' ? 'suppressed' : r.notification.status === 'sent' ? 'accepted_by_provider' : r.notification.status })),
    message: 'Reminders are not proof of medication intake. No reply means not confirmed, not skipped.',
  };
}
export async function markRead(id: string, caller: Caller) {
  if (caller.role !== 'patient') throw forbidden('ROLE_NOT_PERMITTED', 'Patient account required.');
  const result = await prisma.careReminder.updateMany({ where: { id, patient: own(caller.sub), readAt: null }, data: { readAt: new Date() } });
  if (!result.count && !await prisma.careReminder.findFirst({ where: { id, patient: own(caller.sub) }, select: { id: true } })) throw forbidden('NOT_RESOURCE_OWNER', 'Reminder is not yours.');
  return { id, read: true };
}
export async function worklist(caller: Caller, query: { status: string; limit: number; cursor?: string }, now = new Date()) {
  const cpid = await clinician(caller);
  const rows = await prisma.followUpCycle.findMany({ where: { clinicianId: cpid, status: query.status as never },
    include: { patient: { select: { fullName: true } }, _count: { select: { checkIns: { where: { reviewedAt: null, isDeviation: true } } } } },
    orderBy: [{ endDate: 'asc' }, { id: 'asc' }], take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const data = rows.slice(0, query.limit);
  return { data: data.map(c => ({ id: c.id, patient_name: c.patient.fullName, patient_profile_id: c.patientProfileId,
    care_thread_id: c.careThreadId, start_date: iso(c.startDate), end_date: iso(c.endDate),
    status: c.status, outcome: c.outcome, review_due: c.status === 'active' && c.endDate < now,
    unreviewed_checkins: c._count.checkIns, version: c.version })),
    meta: { has_more: rows.length > query.limit, next_cursor: rows.length > query.limit ? data.at(-1)?.id ?? null : null } };
}
export async function workDetail(id: string, caller: Caller, now = new Date()) {
  const cycle = await cycleForClinician(id, caller);
  const [checkins, prescriptions, contacts] = await Promise.all([
    prisma.checkIn.findMany({ where: { followUpCycleId: id }, orderBy: { scheduledAt: 'desc' }, take: 101 }),
    prisma.prescription.findMany({ where: { patientProfileId: cycle.patientProfileId, careThreadId: cycle.careThreadId },
      include: { items: { include: { reminderPlan: true, _count: { select: { adherenceLogs: { where: { reportedStatus: { not: 'unreported' } } } } } } }, adherenceLogs: { where: { supersededAt: null,
        scheduledAt: { gte: new Date(now.getTime() - 7 * 86_400_000), lte: now } }, orderBy: { scheduledAt: 'desc' }, take: 101 } }, take: 21 }),
    prisma.careContact.findMany({ where: { followUpCycleId: id }, orderBy: { scheduledAt: 'desc' }, take: 51 }),
  ]);
  return { id, source_consultation_id: cycle.sourceConsultationId, care_thread_id: cycle.careThreadId, patient_profile_id: cycle.patientProfileId,
    patient_name: cycle.patient.fullName, contact_phone: cycle.patient.user?.phoneNumber ?? cycle.patient.guardian?.phoneNumber ?? null,
    status: cycle.status, outcome: cycle.outcome, end_date: iso(cycle.endDate), version: cycle.version,
    review_due: cycle.status === 'active' && cycle.endDate < now,
    checkins: checkins.slice(0, 100).map(c => ({ id: c.id, scheduled_at: iso(c.scheduledAt), status: c.status,
      is_deviation: c.isDeviation, responses: c.responses, deviation_reasons: c.deviationReasons,
      reviewed_at: iso(c.reviewedAt), review_note: c.reviewNote, version: c.version })), checkins_truncated: checkins.length > 100,
    prescriptions: prescriptions.slice(0, 20).map(p => ({ id: p.id, status: p.status, can_schedule: p.prescribedById === caller.cpid,
      items: p.items.map(i => ({ id: i.id, medication_name: i.medicationName, dosage: i.dosage,
        frequency_per_day: i.frequencyPerDay, duration_days: i.durationDays, has_reports: i._count.adherenceLogs > 0, plan: i.reminderPlan ? planJson(i.reminderPlan) : null })),
      recent_doses: p.adherenceLogs.slice(0, 100).map(d => ({ id: d.id, medication_name: d.medicationName,
        scheduled_at: iso(d.scheduledAt), state: doseState(d.reportedStatus, d.scheduledAt, now) })),
      doses_truncated: p.adherenceLogs.length > 100 })), prescriptions_truncated: prescriptions.length > 20,
    contacts: contacts.slice(0, 50).map(c => contactJson(c)), contacts_truncated: contacts.length > 50 };
}
export async function reviewCheckIn(id: string, caller: Caller, input: { base_version: number; note?: string }, meta: Meta) {
  return prisma.$transaction(async tx => {
    const row = await tx.checkIn.findUnique({ where: { id } });
    if (!row) throw notFound();
    const cycle = await cycleForClinician(row.followUpCycleId, caller, tx);
    await tx.$queryRaw`SELECT id FROM follow_up_cycles WHERE id = ${cycle.id}::uuid FOR UPDATE`;
    if (row.status === 'scheduled' && row.scheduledAt > new Date()) throw conflict('STATE_TRANSITION_INVALID', 'A future check-in cannot be reviewed.');
    const claimed = await tx.checkIn.updateMany({ where: { id, version: input.base_version, reviewedAt: null },
      data: { reviewedById: caller.cpid, reviewedAt: new Date(), reviewNote: input.note ?? null, version: { increment: 1 } } });
    if (!claimed.count) throw conflict('VERSION_CONFLICT', 'This check-in changed or was already reviewed.');
    // Recompute under the cycle lock rather than risking a negative counter.
    const count = await tx.checkIn.count({ where: { followUpCycleId: cycle.id, isDeviation: true, reviewedAt: null } });
    await tx.followUpCycle.update({ where: { id: cycle.id }, data: { openDeviationCount: count, version: { increment: 1 } } });
    await audit(tx, caller, meta, 'care.checkin_reviewed', 'check_ins', id, { cycleId: cycle.id });
    return { id, reviewed: true, open_deviation_count: count };
  }, options);
}
export async function scheduleContact(id: string, caller: Caller, input: { request_key: string; scheduled_at: string; channel: string; purpose: string }, meta: Meta, now = new Date()) {
  return prisma.$transaction(async tx => {
    const cycle = await cycleForClinician(id, caller, tx);
    await tx.$queryRaw`SELECT id FROM follow_up_cycles WHERE id = ${id}::uuid FOR UPDATE`;
    const fresh = await tx.followUpCycle.findUniqueOrThrow({ where: { id } });
    const prior = await tx.careContact.findUnique({ where: { followUpCycleId_requestKey: { followUpCycleId: id, requestKey: input.request_key } } });
    if (prior) {
      if (prior.scheduledAt.toISOString() !== new Date(input.scheduled_at).toISOString() || prior.channel !== input.channel || prior.purpose !== input.purpose) {
        throw conflict('IDEMPOTENCY_KEY_CONFLICT', 'This request key belongs to a different contact request.');
      }
      return contactJson(prior);
    }
    if (fresh.status !== 'active') throw conflict('FOLLOW_UP_CYCLE_CLOSED', 'This follow-up cycle is closed.');
    const at = new Date(input.scheduled_at);
    if (!Number.isFinite(at.getTime()) || at < now || at.getTime() > now.getTime() + 366 * 86_400_000) throw unprocessable('Choose a valid future contact time.');
    const row = await tx.careContact.create({ data: { followUpCycleId: cycle.id, requestKey: input.request_key,
      scheduledAt: at, channel: input.channel, purpose: input.purpose, recordedById: caller.sub } });
    await audit(tx, caller, meta, 'care.contact_scheduled', 'care_contacts', row.id, { cycleId: id, channel: input.channel });
    return contactJson(row);
  }, options);
}
export async function recordContact(id: string, caller: Caller, input: { base_version: number; status: string; note?: string }, meta: Meta) {
  return prisma.$transaction(async tx => {
    const row = await tx.careContact.findUnique({ where: { id } });
    if (!row) throw notFound();
    await cycleForClinician(row.followUpCycleId, caller, tx);
    const claimed = await tx.careContact.updateMany({ where: { id, version: input.base_version, status: 'scheduled' },
      data: { status: input.status, note: input.note ?? null, completedAt: new Date(), version: { increment: 1 } } });
    if (!claimed.count) throw conflict('VERSION_CONFLICT', 'This contact record changed. Reload it.');
    await audit(tx, caller, meta, 'care.contact_recorded', 'care_contacts', id, { status: input.status });
    // No automated clinical recovery outcome is inferred from successful contact.
    return contactJson(await tx.careContact.findUniqueOrThrow({ where: { id } }));
  }, options);
}

/** Prescriber-only medication planning also works without a FollowUpCycle. */
export async function medicationWorklist(caller: Caller, query: { cursor?: string; limit: number }) {
  const cpid = await clinician(caller);
  const rows = await prisma.prescription.findMany({
    where: { prescribedById: cpid, status: { not: 'discontinued' }, consultation: {
      status: 'completed', note: { is: { signedByClinicianId: cpid } },
    } },
    include: { patient: { select: { fullName: true } }, items: { include: {
      reminderPlan: true, _count: { select: { adherenceLogs: { where: { reportedStatus: { not: 'unreported' } } } } },
    } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const data = rows.slice(0, query.limit);
  return { data: data.map(p => ({ id: p.id, patient_name: p.patient.fullName, consultation_id: p.consultationId,
    status: p.status, created_at: iso(p.createdAt), items: p.items.map(i => ({ id: i.id, medication_name: i.medicationName,
      dosage: i.dosage, frequency_per_day: i.frequencyPerDay, duration_days: i.durationDays,
      has_reports: i._count.adherenceLogs > 0, plan: i.reminderPlan ? planJson(i.reminderPlan) : null })),
  })), meta: { has_more: rows.length > query.limit, next_cursor: rows.length > query.limit ? data.at(-1)?.id ?? null : null } };
}
