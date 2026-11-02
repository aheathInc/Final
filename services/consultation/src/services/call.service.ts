import { createHmac } from 'node:crypto';
import { prisma, type Prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound } from '@a-health/http';
import { z } from 'zod';
import type { Caller } from './careThread.service.js';

export const callOfferSchema = z.object({ call_id: z.string().uuid(), sdp: z.string().min(10).max(100000).startsWith('v=0') });
export const callAnswerSchema = z.object({ sdp: z.string().min(10).max(100000).startsWith('v=0') });

const urls = (value?: string) => (value ?? '').split(',').map(v => v.trim()).filter(Boolean);
export function iceConfiguration(userId: string) {
  const stun = urls(process.env.WEBRTC_STUN_URLS);
  const turn = urls(process.env.WEBRTC_TURN_URLS);
  const secret = process.env.WEBRTC_TURN_SECRET;
  if (stun.some(u => !/^stuns?:[^\s]+$/.test(u)) || turn.some(u => !/^turns?:[^\s]+$/.test(u))) {
    throw conflict('CALL_CONFIGURATION_INVALID', 'Calling is not configured correctly. Contact support.');
  }
  const iceServers: { urls: string[]; username?: string; credential?: string }[] = [];
  if (stun.length) iceServers.push({ urls: stun });
  if (turn.length && secret) {
    const username = `${Math.floor(Date.now() / 1000) + 10800}:${userId}`;
    iceServers.push({ urls: turn, username, credential: createHmac('sha1', secret).update(username).digest('base64') });
  }
  const relayConfigured = Boolean(turn.length && secret);
  return { ice_servers: iceServers, relay_configured: relayConfigured,
    available: process.env.NODE_ENV !== 'production' || relayConfigured };
}

async function participant(db: Prisma.TransactionClient | typeof prisma, id: string, caller: Caller, active = true) {
  const c = await db.consultationRequest.findUnique({ where: { id }, include: { patient: true, assignedClinician: true } });
  if (!c) throw notFound('Consultation not found.');
  const actor = await db.user.findUnique({ where: { id: caller.sub } });
  const doctor = actor?.role === 'clinician' && c.assignedClinician?.userId === caller.sub && c.assignedClinician.verificationStatus === 'verified';
  const patient = actor?.role === 'patient' && [c.patient.userId, c.patient.guardianUserId].includes(caller.sub);
  if (actor?.status !== 'active' || (!doctor && !patient)) throw forbidden('NOT_RESOURCE_OWNER', 'Only this consultation’s patient and assigned clinician may join the call.');
  if (c.consultationMode !== 'remote' || !['voice', 'video'].includes(c.modality)) throw conflict('CALL_NOT_APPLICABLE', 'Audio/video calling is available only for the selected remote call mode.');
  if (active && (!c.assignedClinicianId || !['matched', 'in_progress'].includes(c.status))) throw conflict('CALL_NOT_READY', 'Calling is available after the doctor accepts, until the consultation ends.');
  return c;
}

export async function getCall(consultationId: string, caller: Caller) {
  const consultation = await participant(prisma, consultationId, caller);
  // SDP contains connection details. Expired/ended sessions do not retain it.
  await prisma.consultationCall.updateMany({ where: { consultationId, expiresAt: { lte: new Date() }, endedAt: null }, data: { offer: null, answer: null, endedAt: new Date() } });
  const call = await prisma.consultationCall.findFirst({ where: { consultationId, endedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  return { ...iceConfiguration(caller.sub), can_start: consultation.assignedClinician?.userId === caller.sub, call: call ? {
    id: call.id, is_caller: call.callerUserId === caller.sub, offer: call.offer, answer: call.answer,
    expires_at: call.expiresAt.toISOString(),
  } : null };
}

export async function offerCall(consultationId: string, caller: Caller, input: z.infer<typeof callOfferSchema>) {
  const parsed = callOfferSchema.parse(input);
  if (!iceConfiguration(caller.sub).available) throw conflict('CALL_UNAVAILABLE', 'Audio/video calling needs a configured relay server.');
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM consultation_requests WHERE id=${consultationId}::uuid FOR UPDATE`;
    const consultation = await participant(tx, consultationId, caller);
    if (consultation.assignedClinician?.userId !== caller.sub) {
      throw forbidden('CALL_DOCTOR_ONLY', 'Only the assigned doctor may start a call. Wait for the doctor to call you.');
    }
    const prior = await tx.consultationCall.findUnique({ where: { id: parsed.call_id } });
    if (prior) {
      if (prior.consultationId === consultationId && prior.callerUserId === caller.sub && prior.offer === parsed.sdp && !prior.endedAt && prior.expiresAt > new Date()) return;
      throw conflict('CALL_STATE_CHANGED', 'This call attempt is no longer available.');
    }
    if (await tx.consultationCall.count({ where: { consultationId, endedAt: null, expiresAt: { gt: new Date() } } })) throw conflict('CALL_BUSY', 'There is already an active call. Join it or end it first.');
    await tx.consultationCall.create({ data: { id: parsed.call_id, consultationId, callerUserId: caller.sub, offer: parsed.sdp, expiresAt: new Date(Date.now() + 120000) } });
    await appendAudit({ actorUserId: caller.sub, action: 'consultation.call_started', entityType: 'consultation_calls', entityId: parsed.call_id, metadata: { consultationId } }, tx);
  });
  return getCall(consultationId, caller);
}

export async function answerCall(consultationId: string, callId: string, caller: Caller, sdp: string) {
  callAnswerSchema.parse({ sdp });
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM consultation_requests WHERE id=${consultationId}::uuid FOR UPDATE`;
    await participant(tx, consultationId, caller);
    const call = await tx.consultationCall.findUnique({ where: { id: callId } });
    if (!call || call.consultationId !== consultationId || call.endedAt || call.expiresAt <= new Date() || call.callerUserId === caller.sub) throw conflict('CALL_STATE_CHANGED', 'This incoming call is no longer available.');
    if (call.answer) {
      if (call.answererUserId === caller.sub && call.answer === sdp) return;
      throw conflict('CALL_ALREADY_ANSWERED', 'This call was answered on another device.');
    }
    await tx.consultationCall.update({ where: { id: callId }, data: { answer: sdp, answererUserId: caller.sub, expiresAt: new Date(Date.now() + 7200000) } });
    await appendAudit({ actorUserId: caller.sub, action: 'consultation.call_answered', entityType: 'consultation_calls', entityId: callId, metadata: { consultationId } }, tx);
  });
  return getCall(consultationId, caller);
}

export async function endCall(consultationId: string, callId: string, caller: Caller) {
  await participant(prisma, consultationId, caller, false);
  const ended = await prisma.consultationCall.updateMany({ where: { id: callId, consultationId, endedAt: null }, data: { endedAt: new Date(), offer: null, answer: null } });
  if (ended.count) await appendAudit({ actorUserId: caller.sub, action: 'consultation.call_ended', entityType: 'consultation_calls', entityId: callId, metadata: { consultationId } });
  return { ended: true };
}
