import { prisma } from '@a-health/database';
import { mintTokenForPhone } from './internalAuth.js';
import { callInternal } from './internalClient.js';
import { env } from '../config/env.js';

/**
 * Maps a keyword to the same internal call the app would make. A "1" or "2"
 * reply is read as confirming the caller's most recently due, still-open
 * dose reminder — the shape the AdherenceLog reminder template itself
 * prompts for. Anything unrecognised is not discarded: it is routed into
 * the patient's open care thread as an ordinary message, because a person
 * who took the trouble to text in deserves an answer, not silence.
 */
export async function handleInboundSms(from: string, text: string): Promise<void> {
  const auth = await mintTokenForPhone(from);
  if (!auth) return; // unregistered numbers are silently dropped, matching contract's 202-always-accepted shape

  const trimmed = text.trim();

  if ((trimmed === '1' || trimmed === '2') && auth.claims.ppid) {
    const pending = await prisma.adherenceLog.findFirst({
      where: { patientProfileId: auth.claims.ppid, reportedStatus: 'unreported' },
      orderBy: { scheduledAt: 'desc' },
    });
    if (pending) {
      await callInternal(
        env.FOLLOWUP_SERVICE_URL, `/adherence-logs/${pending.id}/confirm`, 'POST', auth.token,
        { reported_status: trimmed === '1' ? 'taken' : 'missed', channel: 'sms' },
      );
      return;
    }
  }

  if (auth.claims.ppid) {
    const thread = await prisma.careThread.findFirst({
      where: { patientProfileId: auth.claims.ppid, status: 'open' },
      orderBy: { updatedAt: 'desc' },
    });
    if (thread) {
      await callInternal(
        env.MESSAGING_SERVICE_URL, `/care-threads/${thread.id}/messages`, 'POST', auth.token,
        { body: text, channel: 'sms' },
      );
    }
  }
}
