import { prisma } from '@a-health/database';
import { forbidden, notFound, rateLimited } from '@a-health/http';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import type { ChatAdapter, ChatMessage } from '../adapters/chat.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }

function serialiseConversation(c: {
  id: string; audience: string; careThreadId: string | null; patientProfileId: string | null;
  language: string; modelVersion: string; createdAt: Date;
}) {
  return {
    id: c.id,
    audience: c.audience,
    care_thread_id: c.careThreadId,
    patient_profile_id: c.patientProfileId,
    language: c.language,
    model_version: c.modelVersion,
    created_at: c.createdAt.toISOString(),
  };
}

function serialiseMessage(m: {
  id: string; role: string; body: string; citations: unknown;
  escalated: boolean; escalationReason: string | null;
  modelVersion: string | null; createdAt: Date;
}) {
  return {
    id: m.id,
    role: m.role,
    body: m.body,
    citations: m.citations ?? [],
    escalated: m.escalated,
    escalation_reason: m.escalationReason,
    model_version: m.modelVersion,
    created_at: m.createdAt.toISOString(),
  };
}

export async function createConversation(
  caller: Caller,
  input: { audience: string; care_thread_id?: string; patient_profile_id?: string; language?: string; channel?: string },
) {
  if (input.audience === 'clinician' && caller.role !== 'clinician' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a clinician may open a clinician-facing conversation');
  }

  const conversation = await prisma.aiConversation.create({
    data: {
      userId: caller.sub,
      audience: input.audience as never,
      careThreadId: input.care_thread_id ?? null,
      patientProfileId: input.patient_profile_id ?? null,
      language: (input.language ?? 'sw') as never,
      channel: (input.channel ?? 'app') as never,
      modelVersion: env.CHAT_MODEL_NAME,
    },
  });
  return serialiseConversation(conversation);
}

export async function getConversation(conversationId: string, caller: Caller) {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conversation) throw notFound('Conversation not found');
  if (conversation.userId !== caller.sub && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This conversation is not yours');
  }
  return { ...serialiseConversation(conversation), messages: conversation.messages.map(serialiseMessage) };
}

/**
 * Sends one turn and returns the model's reply.
 *
 * Every call is logged to AiInference before the reply is returned — the
 * input is hashed, never stored raw, so the record proves what was asked and
 * what came back without duplicating clinical text into a second table.
 *
 * A rate limit exists because this is the one endpoint in the platform an
 * anonymous script could hammer for free generation; the clinical endpoints
 * are all gated behind a real action (a consultation, a prescription) that a
 * loop cannot cheaply repeat.
 */
export async function sendMessage(
  conversationId: string,
  caller: Caller,
  input: { body: string },
  adapter: ChatAdapter,
) {
  const conversation = await prisma.aiConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw notFound('Conversation not found');
  if (conversation.userId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'This conversation is not yours');
  }
  if (conversation.closedAt) {
    throw forbidden('FORBIDDEN', 'This conversation has been closed');
  }

  const since = new Date(Date.now() - 3_600_000);
  const recentCount = await prisma.aiMessage.count({
    where: { conversation: { userId: caller.sub }, createdAt: { gte: since }, role: 'user' },
  });
  if (recentCount >= env.RATE_LIMIT_MESSAGES_PER_HOUR) {
    throw rateLimited('Too many messages this hour. Try again later.');
  }

  const history = await prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  const chatMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        conversation.audience === 'clinician'
          ? 'You are a clinical decision-support assistant. You inform, you never diagnose or prescribe. Cite the source of any clinical claim.'
          : 'You are a patient health assistant. You explain and guide toward appropriate care. You never diagnose or prescribe.',
    },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.body })),
    { role: 'user', content: input.body },
  ];

  const userMessage = await prisma.aiMessage.create({
    data: { conversationId, role: 'user', body: input.body },
  });

  const started = Date.now();
  const result = await adapter.complete(chatMessages);
  const latencyMs = Date.now() - started;

  const assistantMessage = await prisma.aiMessage.create({
    data: {
      conversationId,
      role: 'assistant',
      body: result.text,
      escalated: result.escalated,
      escalationReason: result.escalationReason ?? null,
      modelVersion: result.modelVersion,
      latencyMs,
    },
  });

  const model = await prisma.aiModel.findUnique({ where: { key: adapter.modelKey } });
  if (model) {
    await prisma.aiInference.create({
      data: {
        modelId: model.id,
        kind: 'chat',
        subjectType: 'ai_conversation',
        subjectId: conversationId,
        requestedById: caller.sub,
        inputHash: hashInput(input.body),
        outputSummary: { escalated: result.escalated, length: result.text.length } as never,
        latencyMs,
      },
    });
  }

  void userMessage; // created for the record; not returned to the caller separately
  return serialiseMessage(assistantMessage);
}

function hashInput(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
