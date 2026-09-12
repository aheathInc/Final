import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage, unprocessable } from '@a-health/http';

export interface Caller { sub: string; role: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function assertClinician(caller: Caller): string {
  if (!caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');
  return caller.cpid;
}

function serialiseCommunity(c: { id: string; name: string; specialty: string; description: string | null }, memberCount = 0) {
  return { id: c.id, name: c.name, specialty: c.specialty, member_count: memberCount, description: c.description };
}

export async function listCommunities() {
  const communities = await prisma.community.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  const counts = await prisma.communityMembership.groupBy({ by: ['communityId'], _count: { _all: true } });
  const byId = new Map(counts.map((c) => [c.communityId, c._count._all]));
  return { data: communities.map((c) => serialiseCommunity(c, byId.get(c.id) ?? 0)) };
}

function serialiseDiscussion(d: {
  id: string; communityId: string; title: string; body: string; authorClinicianId: string;
  isCaseDiscussion: boolean; careThreadId: string | null; replyCount: number; createdAt: Date; version: number;
}) {
  return {
    id: d.id,
    community_id: d.communityId,
    title: d.title,
    body: d.body,
    author_clinician_id: d.authorClinicianId,
    is_case_discussion: d.isCaseDiscussion,
    // Present for traceability, but this service never joins from it to a
    // patient — the thread reference is not a path back to identity here.
    care_thread_id: d.careThreadId,
    reply_count: d.replyCount,
    created_at: d.createdAt.toISOString(),
    version: d.version,
  };
}

function serialiseReply(r: { id: string; discussionId: string; body: string; authorClinicianId: string; createdAt: Date }) {
  return {
    id: r.id,
    discussion_id: r.discussionId,
    body: r.body,
    author_clinician_id: r.authorClinicianId,
    created_at: r.createdAt.toISOString(),
  };
}

export async function listDiscussions(query: { community_id?: string; cursor?: string; limit: number }) {
  const rows = await prisma.discussion.findMany({
    where: { ...(query.community_id ? { communityId: query.community_id } : {}) },
    orderBy: { createdAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseDiscussion);
}

export async function getDiscussion(discussionId: string) {
  const discussion = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!discussion) throw notFound('Discussion not found');
  const replies = await prisma.discussionReply.findMany({
    where: { discussionId }, orderBy: { createdAt: 'asc' },
  });
  return { ...serialiseDiscussion(discussion), replies: replies.map(serialiseReply) };
}

/**
 * Verified clinicians only. A case discussion must reference a care thread —
 * the reference is kept for audit traceability, but nothing in this service
 * ever reads back from it to the patient's identity. What is shared is the
 * clinical question the author chose to write, not the record itself.
 */
export async function createDiscussion(
  caller: Caller,
  input: { community_id: string; title: string; body: string; is_case_discussion?: boolean; care_thread_id?: string },
  meta: Meta,
) {
  const cpid = assertClinician(caller);
  if (input.is_case_discussion && !input.care_thread_id) {
    throw unprocessable('care_thread_id is required for a case discussion', 'care_thread_id');
  }

  const community = await prisma.community.findUnique({ where: { id: input.community_id } });
  if (!community) throw notFound('Community not found');

  const discussion = await prisma.discussion.create({
    data: {
      communityId: input.community_id,
      authorClinicianId: cpid,
      title: input.title,
      body: input.body,
      isCaseDiscussion: Boolean(input.is_case_discussion),
      careThreadId: input.is_case_discussion ? (input.care_thread_id ?? null) : null,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'network.discussion_created',
    entityType: 'discussions', entityId: discussion.id,
    metadata: { communityId: input.community_id, isCaseDiscussion: Boolean(input.is_case_discussion) },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseDiscussion(discussion);
}

export async function replyToDiscussion(discussionId: string, caller: Caller, body: string, meta: Meta) {
  const cpid = assertClinician(caller);

  const discussion = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!discussion) throw notFound('Discussion not found');

  const reply = await prisma.$transaction(async (tx) => {
    const created = await tx.discussionReply.create({
      data: { discussionId, authorClinicianId: cpid, body },
    });
    await tx.discussion.update({
      where: { id: discussionId },
      data: { replyCount: { increment: 1 }, version: { increment: 1 } },
    });
    return created;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'network.reply_posted',
    entityType: 'discussion_replies', entityId: reply.id,
    metadata: { discussionId },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseReply(reply);
}
