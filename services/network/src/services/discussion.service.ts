import {
  prisma,
  type Prisma,
  type CommunityNotificationMode,
} from "@a-health/database";
import {
  appendAudit,
  cursorArgs,
  forbidden,
  notFound,
  toCursorPage,
  unprocessable,
} from "@a-health/http";
export interface Caller {
  sub: string;
  role: string;
  cpid?: string;
}
export interface Meta {
  ip?: string | null;
  requestId?: string | null;
}
type Db = Prisma.TransactionClient;
export async function currentNetworkClinician(caller: Caller, db: Db = prisma) {
  if (caller.role !== "clinician" || !caller.cpid)
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "An active verified clinician account is required.",
    );
  const actor = await db.clinicianProfile.findFirst({
    where: {
      id: caller.cpid,
      userId: caller.sub,
      verificationStatus: "verified",
      user: { status: "active", role: "clinician" },
    },
  });
  if (!actor)
    throw forbidden(
      "CLINICIAN_NOT_VERIFIED",
      "An active verified clinician account is required.",
    );
  return actor;
}
async function requireMember(
  communityId: string,
  caller: Caller,
  db: Db = prisma,
) {
  const actor = await currentNetworkClinician(caller, db);
  const member = await db.communityMembership.findUnique({
    where: { communityId_clinicianId: { communityId, clinicianId: actor.id } },
    include: { community: true },
  });
  if (!member || !member.community.isActive)
    throw forbidden(
      "GROUP_MEMBERSHIP_REQUIRED",
      "Join this active professional group to read or contribute.",
    );
  return member;
}
const authorInclude = {
  author: { select: { user: { select: { fullName: true } } } },
} as const;
function serialiseDiscussion(d: {
  id: string;
  communityId: string;
  title: string;
  body: string;
  authorClinicianId: string;
  isCaseDiscussion: boolean;
  replyCount: number;
  createdAt: Date;
  version: number;
  author?: { user: { fullName: string | null } };
}) {
  return {
    id: d.id,
    community_id: d.communityId,
    title: d.title,
    body: d.body,
    author_clinician_id: d.authorClinicianId,
    author_name: d.author?.user.fullName ?? "Clinician",
    is_case_discussion: d.isCaseDiscussion,
    care_thread_id: null,
    reply_count: d.replyCount,
    created_at: d.createdAt.toISOString(),
    version: d.version,
  };
}
function serialiseReply(r: {
  id: string;
  discussionId: string;
  body: string;
  authorClinicianId: string;
  createdAt: Date;
  parentReplyId: string | null;
  author?: { user: { fullName: string | null } };
}) {
  return {
    id: r.id,
    discussion_id: r.discussionId,
    parent_reply_id: r.parentReplyId,
    body: r.body,
    author_clinician_id: r.authorClinicianId,
    author_name: r.author?.user.fullName ?? "Clinician",
    created_at: r.createdAt.toISOString(),
  };
}
export async function listCommunities(caller: Caller) {
  const actor = await currentNetworkClinician(caller);
  const rows = await prisma.community.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { memberships: true } },
      memberships: { where: { clinicianId: actor.id } },
    },
    orderBy: { name: "asc" },
  });
  return {
    data: rows.map((c) => ({
      id: c.id,
      name: c.name,
      specialty: c.specialty,
      description: c.description,
      member_count: c._count.memberships,
      is_member: !!c.memberships.length,
      notification_mode: c.memberships[0]?.notificationMode ?? null,
    })),
  };
}
export async function joinCommunity(
  id: string,
  caller: Caller,
  notificationMode: CommunityNotificationMode = "replies",
) {
  const actor = await currentNetworkClinician(caller);
  const group = await prisma.community.findUnique({ where: { id } });
  if (!group?.isActive) throw notFound("Active group not found.");
  const row = await prisma.communityMembership.upsert({
    where: {
      communityId_clinicianId: { communityId: id, clinicianId: actor.id },
    },
    create: { communityId: id, clinicianId: actor.id, notificationMode },
    update: { notificationMode },
  });
  return {
    community_id: id,
    is_member: true,
    notification_mode: row.notificationMode,
  };
}
export async function leaveCommunity(id: string, caller: Caller) {
  const actor = await currentNetworkClinician(caller);
  await prisma.$transaction(async (tx) => {
    await tx.communityMembership.deleteMany({
      where: { communityId: id, clinicianId: actor.id },
    });
    await tx.professionalNotification.deleteMany({
      where: {
        recipientClinicianId: actor.id,
        discussion: { communityId: id },
      },
    });
  });
  return { community_id: id, is_member: false };
}
export async function listDiscussions(
  caller: Caller,
  query: { community_id?: string; cursor?: string; limit: number },
) {
  const actor = await currentNetworkClinician(caller);
  if (query.community_id) await requireMember(query.community_id, caller);
  const rows = await prisma.discussion.findMany({
    where: {
      ...(query.community_id ? { communityId: query.community_id } : {}),
      community: {
        isActive: true,
        memberships: { some: { clinicianId: actor.id } },
      },
    },
    include: authorInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseDiscussion);
}
export async function listReplies(
  discussionId: string,
  caller: Caller,
  query: { cursor?: string; limit: number },
) {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
  });
  if (!discussion) throw notFound("Discussion not found");
  await requireMember(discussion.communityId, caller);
  const rows = await prisma.discussionReply.findMany({
    where: { discussionId },
    include: authorInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...cursorArgs(query.cursor, query.limit),
  });
  const page = toCursorPage(rows, query.limit, serialiseReply);
  return { ...page, data: page.data as ReturnType<typeof serialiseReply>[] };
}
export async function getDiscussion(discussionId: string, caller: Caller) {
  const d = await prisma.discussion.findUnique({
    where: { id: discussionId },
    include: { ...authorInclude, community: { select: { name: true } } },
  });
  if (!d) throw notFound("Discussion not found");
  await requireMember(d.communityId, caller);
  const replies = await listReplies(discussionId, caller, { limit: 50 });
  return {
    ...serialiseDiscussion(d),
    community_name: d.community.name,
    replies: replies.data,
    replies_meta: replies.meta,
  };
}
async function notify(
  tx: Db,
  discussion: { id: string; communityId: string; authorClinicianId: string },
  sender: string,
  reply?: { id: string; parentReplyId: string | null },
) {
  const participants = new Set([discussion.authorClinicianId]);
  if (reply) {
    const authors = await tx.discussionReply.findMany({
      where: { discussionId: discussion.id },
      select: { authorClinicianId: true },
      distinct: ["authorClinicianId"],
    });
    authors.forEach((a) => participants.add(a.authorClinicianId));
  }
  const members = await tx.communityMembership.findMany({
    where: {
      communityId: discussion.communityId,
      clinicianId: { not: sender },
      notificationMode: { not: "muted" },
      clinician: {
        verificationStatus: "verified",
        user: { status: "active", role: "clinician" },
      },
    },
  });
  const recipients = members.filter(
    (m) =>
      m.notificationMode === "all" ||
      (!!reply && participants.has(m.clinicianId)),
  );
  if (recipients.length)
    await tx.professionalNotification.createMany({
      data: recipients.map((m) => ({
        recipientClinicianId: m.clinicianId,
        discussionId: discussion.id,
        replyId: reply?.id ?? null,
        kind: reply ? "reply" : "new_post",
        dedupeKey: `${reply?.id ?? discussion.id}:${m.clinicianId}`,
      })),
      skipDuplicates: true,
    });
}
export async function createDiscussion(
  caller: Caller,
  input: {
    community_id: string;
    title: string;
    body: string;
    is_case_discussion?: boolean;
    care_thread_id?: string;
  },
  meta: Meta,
) {
  return prisma.$transaction(async (tx) => {
    const member = await requireMember(input.community_id, caller, tx);
    if (input.is_case_discussion) {
      if (!input.care_thread_id)
        throw unprocessable(
          "care_thread_id is required for a case discussion",
          "care_thread_id",
        );
      const thread = await tx.careThread.findFirst({
        where: {
          id: input.care_thread_id,
          OR: [
            { primaryClinicianId: caller.cpid },
            { consultations: { some: { assignedClinicianId: caller.cpid } } },
          ],
        },
      });
      if (!thread)
        throw forbidden(
          "NOT_RESOURCE_OWNER",
          "You may discuss only an assigned care thread, without patient identifiers.",
        );
    }
    const d = await tx.discussion.create({
      data: {
        communityId: member.communityId,
        authorClinicianId: member.clinicianId,
        title: input.title.trim(),
        body: input.body.trim(),
        isCaseDiscussion: !!input.is_case_discussion,
        careThreadId: input.is_case_discussion ? input.care_thread_id : null,
      },
      include: authorInclude,
    });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.discussion_created",
        entityType: "discussions",
        entityId: d.id,
        metadata: { communityId: d.communityId },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    await notify(tx, d, member.clinicianId);
    return serialiseDiscussion(d);
  });
}
export async function replyToDiscussion(
  discussionId: string,
  caller: Caller,
  body: string,
  meta: Meta,
  parentReplyId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.discussion.findUnique({ where: { id: discussionId } });
    if (!d) throw notFound("Discussion not found");
    const member = await requireMember(d.communityId, caller, tx);
    let parent = parentReplyId,
      depth = 0;
    while (parent) {
      if (++depth > 8)
        throw unprocessable(
          "This thread has reached eight reply levels. Reply to an earlier message.",
        );
      const row = await tx.discussionReply.findUnique({
        where: { id: parent },
      });
      if (!row || row.discussionId !== discussionId)
        throw unprocessable(
          "The parent reply must belong to this discussion.",
          "parent_reply_id",
        );
      parent = row.parentReplyId ?? undefined;
    }
    const reply = await tx.discussionReply.create({
      data: {
        discussionId,
        authorClinicianId: member.clinicianId,
        body: body.trim(),
        parentReplyId: parentReplyId ?? null,
      },
      include: authorInclude,
    });
    await tx.discussion.update({
      where: { id: discussionId },
      data: { replyCount: { increment: 1 }, version: { increment: 1 } },
    });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.reply_posted",
        entityType: "discussion_replies",
        entityId: reply.id,
        metadata: { discussionId, parentReplyId: parentReplyId ?? null },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    await notify(tx, d, member.clinicianId, reply);
    return serialiseReply(reply);
  });
}
export async function listNotifications(caller: Caller) {
  const actor = await currentNetworkClinician(caller);
  const where = {
    recipientClinicianId: actor.id,
    discussion: {
      community: {
        isActive: true,
        memberships: { some: { clinicianId: actor.id } },
      },
    },
  };
  const [rows, unread] = await Promise.all([
    prisma.professionalNotification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      include: {
        discussion: {
          select: {
            id: true,
            title: true,
            community: { select: { name: true } },
          },
        },
      },
    }),
    prisma.professionalNotification.count({
      where: { ...where, readAt: null },
    }),
  ]);
  return {
    unread_count: unread,
    data: rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      discussion_id: n.discussionId,
      title: n.discussion.title,
      group_name: n.discussion.community.name,
      read_at: n.readAt?.toISOString() ?? null,
      created_at: n.createdAt.toISOString(),
      href: `/doctor/network/${n.discussionId}#replies`,
    })),
  };
}
export async function markNotificationRead(id: string, caller: Caller) {
  const actor = await currentNetworkClinician(caller);
  const changed = await prisma.professionalNotification.updateMany({
    where: {
      id,
      recipientClinicianId: actor.id,
      discussion: {
        community: {
          isActive: true,
          memberships: { some: { clinicianId: actor.id } },
        },
      },
    },
    data: { readAt: new Date() },
  });
  if (!changed.count) throw notFound("Notification not found");
  return { read: true };
}
