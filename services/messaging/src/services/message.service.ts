import { prisma } from '@a-health/database';
import {
  conflict, cursorArgs, forbidden, notFound, toCursorPage,
  type DomainEvent, type EventBus,
} from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(m: {
  id: string; careThreadId: string; consultationId: string | null;
  senderUserId: string; body: string | null; attachmentKey: string | null;
  attachmentType: string | null; deliveredVia: string; readAt: Date | null;
  createdAt: Date; clientCreatedAt: Date | null; version: number;
}) {
  return {
    id: m.id,
    care_thread_id: m.careThreadId,
    consultation_id: m.consultationId,
    sender_user_id: m.senderUserId,
    body: m.body,
    attachment_key: m.attachmentKey,
    attachment_type: m.attachmentType,
    delivered_via: m.deliveredVia,
    read_at: m.readAt?.toISOString() ?? null,
    created_at: m.createdAt.toISOString(),
    client_created_at: m.clientCreatedAt?.toISOString() ?? null,
    version: m.version,
  };
}

/**
 * Who may read and write on a thread: the patient it belongs to, that
 * patient's guardian, the thread's primary clinician, and any clinician who
 * has worked a consultation on it.
 *
 * Deliberately not "any verified clinician". A colleague being able to read a
 * conversation they were never part of is a privacy failure, not a
 * convenience.
 */
async function participantsOf(careThreadId: string) {
  const thread = await prisma.careThread.findUnique({
    where: { id: careThreadId },
    include: {
      patient: { select: { id: true, userId: true, guardianUserId: true } },
      primaryClinician: { select: { id: true, userId: true } },
      consultations: {
        select: { assignedClinician: { select: { id: true, userId: true } } },
      },
    },
  });
  if (!thread) throw notFound('Care thread not found');

  const clinicianUserIds = new Set<string>();
  if (thread.primaryClinician?.userId) clinicianUserIds.add(thread.primaryClinician.userId);
  for (const c of thread.consultations) {
    if (c.assignedClinician?.userId) clinicianUserIds.add(c.assignedClinician.userId);
  }

  const patientUserIds = new Set<string>();
  if (thread.patient.userId) patientUserIds.add(thread.patient.userId);
  if (thread.patient.guardianUserId) patientUserIds.add(thread.patient.guardianUserId);

  return { thread, patientUserIds, clinicianUserIds };
}

async function assertParticipant(careThreadId: string, caller: Caller) {
  const p = await participantsOf(careThreadId);
  const allowed =
    caller.role === 'platform_admin' ||
    p.patientUserIds.has(caller.sub) ||
    p.clinicianUserIds.has(caller.sub);
  if (!allowed) throw forbidden('NOT_RESOURCE_OWNER', 'You are not part of this conversation');
  return p;
}

export async function listMessages(
  careThreadId: string,
  caller: Caller,
  query: { consultation_id?: string; cursor?: string; limit: number },
) {
  await assertParticipant(careThreadId, caller);

  const rows = await prisma.message.findMany({
    where: {
      careThreadId,
      ...(query.consultation_id ? { consultationId: query.consultation_id } : {}),
    },
    orderBy: { createdAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialise);
}

/**
 * Posts to the thread, not to a consultation.
 *
 * The consultation link is filled in automatically when one is open, and left
 * null when none is. That null is the feature: a patient must be able to
 * message their clinician on day nine after a day-one discharge without
 * opening a new case, and that is what "follow-up till cure" means in
 * practice.
 */
export async function createMessage(
  careThreadId: string,
  caller: Caller,
  input: {
    body?: string;
    attachment_key?: string;
    attachment_type?: string;
    client_created_at?: string;
  },
  bus: EventBus,
  meta: Meta,
) {
  const { thread, patientUserIds, clinicianUserIds } = await assertParticipant(careThreadId, caller);

  if (thread.status === 'closed') {
    throw conflict('CARE_THREAD_CLOSED', 'This care thread is closed. Raise a new consultation.');
  }

  const openConsultation = await prisma.consultationRequest.findFirst({
    where: { careThreadId, status: { in: ['matched', 'in_progress'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  const message = await prisma.message.create({
    data: {
      careThreadId,
      consultationId: openConsultation?.id ?? null,
      senderUserId: caller.sub,
      body: input.body ?? null,
      attachmentKey: input.attachment_key ?? null,
      attachmentType: (input.attachment_type ?? null) as never,
      deliveredVia: 'app',
      clientCreatedAt: input.client_created_at ? new Date(input.client_created_at) : null,
    },
  });

  await prisma.careThread.update({
    where: { id: careThreadId },
    data: { version: { increment: 1 } },
  });

  const recipients = [...new Set([...patientUserIds, ...clinicianUserIds])].filter(
    (id) => id !== caller.sub,
  );

  // Queued for the notification service to deliver over whichever channel the
  // recipient actually uses. A feature-phone user gets SMS; the sender never
  // chooses the transport.
  if (recipients.length > 0) {
    await prisma.notificationLog.createMany({
      data: recipients.map((userId) => ({
        userId,
        channel: 'app' as never,
        templateKey: 'thread.message',
        payload: { careThreadId, messageId: message.id } as never,
      })),
    });
  }

  const event: DomainEvent = {
    event: 'consultation.message',
    entity: 'messages',
    id: message.id,
    version: message.version,
    careThreadId,
    audienceUserIds: recipients,
    data: { sender_user_id: caller.sub, preview: (input.body ?? '[attachment]').slice(0, 120) },
  };
  await bus.publish(event);

  return serialise(message);
}

/**
 * Marks everything up to a message as read.
 *
 * Only the other party's messages are touched — marking your own as read is
 * meaningless, and doing it would make the sender's unread count wrong.
 */
export async function markRead(
  careThreadId: string,
  caller: Caller,
  upToMessageId: string,
) {
  await assertParticipant(careThreadId, caller);

  const marker = await prisma.message.findUnique({ where: { id: upToMessageId } });
  if (!marker || marker.careThreadId !== careThreadId) {
    throw notFound('Message not found on this thread');
  }

  const result = await prisma.message.updateMany({
    where: {
      careThreadId,
      senderUserId: { not: caller.sub },
      readAt: null,
      createdAt: { lte: marker.createdAt },
    },
    data: { readAt: new Date() },
  });

  return { marked_read: result.count };
}
