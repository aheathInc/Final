import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';

export interface Caller { sub: string; role: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function assertClinician(caller: Caller): string {
  if (!caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');
  return caller.cpid;
}

function serialise(s: {
  id: string; careThreadId: string; requestedById: string; answeredById: string | null;
  specialty: string; question: string; answer: string | null; status: string;
  requestedAt: Date; answeredAt: Date | null; version: number;
}) {
  return {
    id: s.id,
    care_thread_id: s.careThreadId,
    requested_by_id: s.requestedById,
    answered_by_id: s.answeredById,
    specialty: s.specialty,
    question: s.question,
    answer: s.answer,
    status: s.status,
    requested_at: s.requestedAt.toISOString(),
    answered_at: s.answeredAt?.toISOString() ?? null,
    version: s.version,
  };
}

/**
 * Store-and-forward by design: a rural clinician submits history and images,
 * and a specialist answers when able. No requirement that both are online at
 * once — that requirement is what makes specialist access fail outside
 * cities.
 */
export async function requestSecondOpinion(
  caller: Caller,
  input: { care_thread_id: string; specialty: string; question: string; attachment_keys?: string[] },
  meta: Meta,
) {
  const cpid = assertClinician(caller);

  const thread = await prisma.careThread.findUnique({ where: { id: input.care_thread_id } });
  if (!thread) throw notFound('Care thread not found');

  const opinion = await prisma.secondOpinion.create({
    data: {
      careThreadId: input.care_thread_id,
      requestedById: cpid,
      specialty: input.specialty as never,
      question: input.question,
      attachmentKeys: (input.attachment_keys ?? []) as never,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'network.second_opinion_requested',
    entityType: 'second_opinions', entityId: opinion.id,
    metadata: { specialty: input.specialty },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(opinion);
}

export async function listSecondOpinions(query: { status?: string; specialty?: string; cursor?: string; limit: number }) {
  const rows = await prisma.secondOpinion.findMany({
    where: {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.specialty ? { specialty: query.specialty as never } : {}),
    },
    orderBy: { requestedAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialise);
}

/** First claim wins — the conditional update is the concurrency guarantee, same pattern as consultation offer acceptance. */
export async function claimSecondOpinion(id: string, caller: Caller, meta: Meta) {
  const cpid = assertClinician(caller);

  const claimed = await prisma.secondOpinion.updateMany({
    where: { id, status: 'open' },
    data: { status: 'claimed', answeredById: cpid, version: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    throw conflict('STATE_TRANSITION_INVALID', 'This second opinion is no longer open to claim');
  }

  await appendAudit({
    actorUserId: caller.sub, action: 'network.second_opinion_claimed',
    entityType: 'second_opinions', entityId: id,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(await prisma.secondOpinion.findUniqueOrThrow({ where: { id } }));
}

/** Only the clinician who claimed it may answer — checked, not merely implied by the flow. */
export async function answerSecondOpinion(id: string, caller: Caller, answer: string, meta: Meta) {
  const cpid = assertClinician(caller);

  const opinion = await prisma.secondOpinion.findUnique({ where: { id } });
  if (!opinion) throw notFound('Second opinion not found');
  if (opinion.status !== 'claimed') {
    throw conflict('STATE_TRANSITION_INVALID', 'This second opinion has not been claimed');
  }
  if (opinion.answeredById !== cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'Only the clinician who claimed this may answer it');
  }

  const updated = await prisma.secondOpinion.update({
    where: { id },
    data: { answer, status: 'answered', answeredAt: new Date(), version: { increment: 1 } },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'network.second_opinion_answered',
    entityType: 'second_opinions', entityId: id,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(updated);
}
