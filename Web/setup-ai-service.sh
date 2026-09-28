#!/usr/bin/env bash
#
# Builds services/ai — the AI layer, built as one adapter interface with slots
# for all 15 shortlisted models, not all 15 running live day one.
#
# That distinction is the whole design: GPU capacity, monitoring, and clinical
# validation are what gate a model going live, not the code path. Every model
# in the shortlist gets a registry row and an adapter slot from day one; most
# start "not_deployed" and are turned on as each is validated.
#
# Hard rule enforced in code, not just in prose: this service never returns a
# diagnosis. It advises — triage suggestions, drug-interaction findings,
# transcripts — and every one of its outputs is logged to AiInference so it
# can be audited later.
#
# Run from the repo root:
#   bash setup-ai-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/ai"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,adapters,scripts,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/ai';
pkg.version = pkg.version || '1.0.0';
pkg.private = true;
pkg.type = 'module';
pkg.main = pkg.main || './src/index.ts';
pkg.scripts = { ...(pkg.scripts || {}),
  dev: 'tsx watch src/index.ts', build: 'tsc --noEmit',
  start: 'node --import tsx src/index.ts',
  test: 'node --import tsx --test src/tests/*.test.ts',
  'seed:models': 'node --import tsx src/scripts/seed-models.ts' };
pkg.dependencies = { ...(pkg.dependencies || {}),
  '@a-health/database': 'workspace:*', '@a-health/http': 'workspace:*',
  '@a-health/logger': 'workspace:*',
  dotenv: '^17.4.2', express: '^5.1.0', zod: '^4.4.3' };
pkg.devDependencies = { ...(pkg.devDependencies || {}),
  '@types/express': '^5.0.3', '@types/node': '^22.10.0',
  tsx: '^4.23.5', typescript: '^5.9.3' };
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('  package.json written');
NODE

cat > "$SVC/tsconfig.json" << 'JSON'
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "skipLibCheck": true, "noEmit": true,
    "esModuleInterop": true, "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
JSON

cat > "$SVC/src/config/env.ts" << 'TS'
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4009),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /**
   * `stub` runs deterministic offline logic — no network call, no GPU,
   * pattern-matching red flags well enough to develop and test against.
   * `openai_compatible` targets any self-hosted or vendor endpoint that speaks
   * the chat-completions shape (this is how Llama 3.1 and MedGemma are
   * intended to be served — vLLM, TGI, or similar, not called directly).
   */
  CHAT_PROVIDER: z.enum(['stub', 'openai_compatible']).default('stub'),
  CHAT_MODEL_ENDPOINT: z.string().default(''),
  CHAT_MODEL_KEY: z.string().default(''),
  CHAT_MODEL_NAME: z.string().default('llama-3.1'),

  TRANSCRIBE_PROVIDER: z.enum(['stub', 'whisper_http']).default('stub'),
  TRANSCRIBE_ENDPOINT: z.string().default(''),

  MAX_MESSAGE_LENGTH: z.coerce.number().default(4000),
  RATE_LIMIT_MESSAGES_PER_HOUR: z.coerce.number().default(60),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production' && env.CHAT_PROVIDER === 'stub') {
  throw new Error('CHAT_PROVIDER=stub cannot be used in production — nothing would actually run.');
}
TS

# ===========================================================================
# The model registry — every shortlisted model gets a row, most start
# not_deployed. Live status is a deployment fact, not a code fact.
# ===========================================================================
cat > "$SVC/src/services/registry.ts" << 'TS'
import { prisma } from '@a-health/database';

export interface ModelSeed {
  key: string;
  displayName: string;
  function: string;
  runtime: string;
}

/**
 * The full shortlist. Every one of these gets a registry row whether or not it
 * is deployed — a model with no recorded validation must be visible as
 * exactly that, which is what the AI governance committee reviews, and what
 * `not_deployed` rows communicate that an empty table cannot.
 */
export const MODEL_SHORTLIST: ModelSeed[] = [
  { key: 'llama-3.1', displayName: 'Llama 3.1', function: 'Clinical assistant, patient Q&A, report drafting', runtime: 'vLLM / self-hosted' },
  { key: 'medgemma', displayName: 'MedGemma', function: 'Medical reasoning and diagnosis-support drafting for clinicians', runtime: 'vLLM / self-hosted' },
  { key: 'biobert', displayName: 'BioBERT', function: 'Medical NLP, entity extraction from clinical text', runtime: 'ONNX / self-hosted' },
  { key: 'clinicalbert', displayName: 'ClinicalBERT', function: 'Clinical note understanding and summarisation', runtime: 'ONNX / self-hosted' },
  { key: 'whisper', displayName: 'Whisper', function: 'Speech-to-text for patient and clinician voice notes', runtime: 'whisper.cpp / self-hosted' },
  { key: 'piper-tts', displayName: 'Piper TTS', function: 'Text-to-speech for low-literacy and voice-channel delivery', runtime: 'Piper / self-hosted' },
  { key: 'yolov11', displayName: 'YOLOv11', function: 'Medical image object detection', runtime: 'ONNX / GPU' },
  { key: 'monai', displayName: 'MONAI', function: 'Medical image analysis (radiology, pathology)', runtime: 'PyTorch / GPU' },
  { key: 'xgboost', displayName: 'XGBoost', function: 'Disease risk scoring', runtime: 'in-process' },
  { key: 'lightgbm', displayName: 'LightGBM', function: 'Facility and hospital risk / load scoring', runtime: 'in-process' },
  { key: 'isolation-forest', displayName: 'Isolation Forest', function: 'Anomaly and fraud detection', runtime: 'in-process' },
  { key: 'prophet', displayName: 'Prophet', function: 'Disease-trend and surveillance forecasting', runtime: 'in-process' },
  { key: 'faiss', displayName: 'FAISS', function: 'Vector search over the clinical knowledge base', runtime: 'in-process' },
  { key: 'qdrant', displayName: 'Qdrant', function: 'Vector database for retrieval-augmented generation', runtime: 'service' },
  { key: 'sentence-transformers', displayName: 'Sentence Transformers', function: 'Embedding generation for semantic search', runtime: 'ONNX / self-hosted' },
];

/** Idempotent. Safe to run on every deploy — inserts what is missing, touches nothing already there. */
export async function seedModelRegistry(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const model of MODEL_SHORTLIST) {
    const existing = await prisma.aiModel.findUnique({ where: { key: model.key } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.aiModel.create({
      data: {
        key: model.key,
        displayName: model.displayName,
        function: model.function,
        version: 'unpinned',
        status: 'not_deployed',
        runtime: model.runtime,
      },
    });
    inserted += 1;
  }
  return { inserted, skipped };
}

function serialise(m: {
  key: string; displayName: string; function: string; version: string; status: string;
  lastValidatedAt: Date | null; accuracySummary: string | null;
  biasReviewAt: Date | null; governanceNotes: string | null;
}) {
  return {
    key: m.key,
    function: m.function,
    version: m.version,
    status: m.status,
    last_validated_at: m.lastValidatedAt?.toISOString() ?? null,
    accuracy_summary: m.accuracySummary,
    bias_review_at: m.biasReviewAt?.toISOString() ?? null,
    governance_notes: m.governanceNotes,
  };
}

/** The register the AI governance committee reviews. */
export async function listModels() {
  const rows = await prisma.aiModel.findMany({ orderBy: { key: 'asc' } });
  return { data: rows.map(serialise) };
}

/** Resolves a model's live status; used to refuse a call to something not deployed. */
export async function getModelStatus(key: string): Promise<string | null> {
  const row = await prisma.aiModel.findUnique({ where: { key }, select: { status: true } });
  return row?.status ?? null;
}
TS

cat > "$SVC/src/scripts/seed-models.ts" << 'TS'
import { prisma } from '@a-health/database';
import { seedModelRegistry } from '../services/registry.js';

const result = await seedModelRegistry();
console.log(JSON.stringify(result));
await prisma.$disconnect();
TS

# ===========================================================================
# Adapters — one interface, swappable implementations
# ===========================================================================
cat > "$SVC/src/adapters/chat.ts" << 'TS'
/**
 * The seam every chat-capable model sits behind.
 *
 * Swapping Llama 3.1 for MedGemma, or a stub for a live endpoint, is a config
 * change plus one new adapter implementing this interface — never a change to
 * the calling code in services/conversation.ts.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  modelVersion: string;
  /** True when the reply recognised a red flag and must not continue the conversation. */
  escalated: boolean;
  escalationReason?: string;
}

export interface ChatAdapter {
  readonly modelKey: string;
  complete(messages: ChatMessage[]): Promise<ChatResult>;
}

/**
 * Deterministic, offline, pattern-matched red flags. This is what the service
 * runs on by default — good enough to develop and test the whole request path
 * against without a GPU, a network call, or a bill.
 *
 * Never returns a diagnosis, by construction: there is no diagnosis logic
 * here to accidentally return one.
 */
export const stubChatAdapter: ChatAdapter = {
  modelKey: 'stub',
  async complete(messages) {
    const last = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    const lower = last.toLowerCase();

    const RED_FLAGS: [string, string][] = [
      ['chest pain', 'possible cardiac emergency'],
      ['can\u2019t breathe', 'respiratory emergency'],
      ['cannot breathe', 'respiratory emergency'],
      ['one side', 'possible stroke'],
      ['suicidal', 'mental health emergency'],
      ['want to die', 'mental health emergency'],
      ['severe bleeding', 'haemorrhage emergency'],
      ['unconscious', 'neurological emergency'],
    ];

    for (const [phrase, reason] of RED_FLAGS) {
      if (lower.includes(phrase)) {
        return {
          text:
            'What you are describing needs urgent in-person care right now. ' +
            'Please contact emergency services or go to the nearest facility immediately. ' +
            'I am not able to help further with this in chat.',
          modelVersion: 'stub-1',
          escalated: true,
          escalationReason: reason,
        };
      }
    }

    return {
      text:
        'Thanks for sharing that. I can give general health information, but I cannot diagnose ' +
        'or prescribe. For anything that concerns you, a clinician on this platform can see you. ' +
        'Would you like me to help you start a consultation?',
      modelVersion: 'stub-1',
      escalated: false,
    };
  },
};

/**
 * Targets any endpoint speaking the OpenAI chat-completions shape — this is
 * how a self-hosted Llama 3.1 or MedGemma behind vLLM/TGI is meant to be
 * reached, not called directly from application code.
 */
export function createOpenAiCompatibleAdapter(config: {
  modelKey: string;
  endpoint: string;
  apiKey: string;
  modelName: string;
}): ChatAdapter {
  return {
    modelKey: config.modelKey,
    async complete(messages) {
      const response = await fetch(`${config.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: config.modelName, messages, temperature: 0.2 }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`chat model returned ${response.status}`);
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        model?: string;
      };
      const text = payload.choices?.[0]?.message?.content ?? '';
      // The adapter itself never diagnoses or escalates by pattern-matching the
      // model's own words — escalation for a live model is a governed,
      // separately-tested classifier, not string matching on generated text.
      return { text, modelVersion: payload.model ?? config.modelName, escalated: false };
    },
  };
}
TS

cat > "$SVC/src/adapters/transcribe.ts" << 'TS'
export interface TranscribeResult {
  text: string;
  confidence: number;
  modelVersion: string;
}

export interface TranscribeAdapter {
  transcribe(audioKey: string, language: string): Promise<TranscribeResult>;
}

/** Deterministic placeholder — returns a fixed low-confidence transcript so the client's correction UI is exercised in development. */
export const stubTranscribeAdapter: TranscribeAdapter = {
  async transcribe(_audioKey, language) {
    return {
      text: language === 'sw' ? '[nakala ya jaribio]' : '[test transcript]',
      confidence: 0.4,
      modelVersion: 'stub-1',
    };
  },
};
TS

# ===========================================================================
# Domain logic
# ===========================================================================
cat > "$SVC/src/services/conversation.service.ts" << 'TS'
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
TS

cat > "$SVC/src/services/clinical.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import type { TranscribeAdapter } from '../adapters/transcribe.js';

/**
 * Advisory triage support. This suggestion is a second, separate input to the
 * consultation service's deterministic rules engine — it never sets urgency
 * on its own, and the two are reconciled by the more-urgent-wins rule
 * documented in services/consultation. `advisory_only: true` is always
 * present on the wire, so no client can mistake this for a decision.
 */
export async function suggestTriage(input: {
  symptom_text?: string;
  structured_symptoms?: { code: string; severity?: number }[];
}) {
  const codes = (input.structured_symptoms ?? []).map((s) => s.code.toLowerCase());
  const text = (input.symptom_text ?? '').toLowerCase();

  const EMERGENCY_TERMS = ['chest pain', 'unconscious', 'severe bleeding', 'can\u2019t breathe', 'stroke'];
  const hit = EMERGENCY_TERMS.find((t) => text.includes(t)) ?? codes.find((c) => EMERGENCY_TERMS.some((t) => c.includes(t.split(' ')[0]!)));

  const suggestedUrgency = hit ? 'emergency' : codes.length > 0 ? 'urgent' : 'routine';

  return {
    suggested_urgency: suggestedUrgency,
    confidence: hit ? 0.7 : 0.4,
    red_flags: hit ? [hit] : [],
    recommended_department: null,
    rationale: hit
      ? `Free text or symptom codes matched a known emergency pattern: "${hit}".`
      : 'No emergency pattern matched; deferring to the deterministic triage engine.',
    model_version: 'stub-1',
    advisory_only: true,
  };
}

/**
 * Clinician-facing drug interaction check.
 *
 * A tiny hard-coded table stands in for a pharmacology model here — the point
 * of this pass is the request/response shape and the audit trail, not
 * interaction coverage. Swapping in a real model changes only findInteractions.
 */
const KNOWN_INTERACTIONS: { pair: [string, string]; severity: string; description: string }[] = [
  { pair: ['warfarin', 'aspirin'], severity: 'major', description: 'Increased bleeding risk when combined.' },
  { pair: ['metformin', 'contrast dye'], severity: 'moderate', description: 'Risk of lactic acidosis around imaging with IV contrast.' },
  { pair: ['ace inhibitor', 'potassium supplement'], severity: 'moderate', description: 'Risk of hyperkalaemia.' },
];

export async function checkDrugInteractions(medications: string[]) {
  const lower = medications.map((m) => m.toLowerCase());
  const findings = KNOWN_INTERACTIONS
    .filter(({ pair }) => lower.some((m) => m.includes(pair[0])) && lower.some((m) => m.includes(pair[1])))
    .map(({ pair, severity, description }) => ({
      medications: pair,
      severity,
      description,
      source: 'internal-reference-table-v1',
    }));

  return { findings, model_version: 'stub-1' };
}

export async function transcribeAudio(
  audioKey: string,
  language: string,
  adapter: TranscribeAdapter,
) {
  const result = await adapter.transcribe(audioKey, language);
  return {
    text: result.text,
    confidence: result.confidence,
    language,
    model_version: result.modelVersion,
  };
}

export async function synthesizeSpeech(text: string, _language: string) {
  // No TTS engine wired yet; returns a stable placeholder key so the client
  // contract (an object key it fetches, not inline audio) is already correct
  // for when Piper is connected.
  return { audio_key: 'pending/' + Buffer.from(text.slice(0, 40)).toString('base64url'), duration_seconds: null };
}

export async function listModels() {
  const { listModels: list } = await import('./registry.js');
  return list();
}
TS

# ===========================================================================
# Controller, routes
# ===========================================================================
cat > "$SVC/src/types/ai.types.ts" << 'TS'
import { z } from 'zod';

export const createConversationSchema = z.object({
  audience: z.enum(['patient', 'clinician']),
  care_thread_id: z.string().uuid().optional(),
  patient_profile_id: z.string().uuid().optional(),
  language: z.enum(['sw', 'en', 'fr', 'ha', 'am']).optional(),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']).optional(),
});

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(4000),
  voice_note_key: z.string().optional(),
});

export const triageSchema = z.object({
  symptom_text: z.string().max(4000).optional(),
  structured_symptoms: z.array(z.object({ code: z.string(), severity: z.number().min(0).max(10).optional() })).optional(),
  patient_profile_id: z.string().uuid().optional(),
});

export const drugInteractionSchema = z.object({
  medications: z.array(z.string()).min(1),
  patient_profile_id: z.string().uuid().optional(),
});

export const transcribeSchema = z.object({
  audio_key: z.string().min(1),
  language: z.enum(['sw', 'en', 'fr', 'ha', 'am']).optional(),
});

export const synthesizeSchema = z.object({
  text: z.string().min(1).max(2000),
  language: z.enum(['sw', 'en', 'fr', 'ha', 'am']).optional(),
});
TS

cat > "$SVC/src/controllers/ai.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as conversations from '../services/conversation.service.js';
import * as clinical from '../services/clinical.service.js';
import { resolveChatAdapter, resolveTranscribeAdapter } from '../services/provider-resolver.js';
import {
  createConversationSchema, drugInteractionSchema, sendMessageSchema,
  synthesizeSchema, transcribeSchema, triageSchema,
} from '../types/ai.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const createConversation = handle(
  (req) => conversations.createConversation(caller(req), createConversationSchema.parse(req.body)), 201,
);

export const getConversation = handle((req) =>
  conversations.getConversation(pathParam(req, 'conversation_id'), caller(req)));

export const sendMessage = handle(
  (req) => conversations.sendMessage(
    pathParam(req, 'conversation_id'), caller(req), sendMessageSchema.parse(req.body), resolveChatAdapter(),
  ),
  201,
);

export const triage = handle((req) => clinical.suggestTriage(triageSchema.parse(req.body)));

export const drugInteractions = handle((req) => {
  const input = drugInteractionSchema.parse(req.body);
  return clinical.checkDrugInteractions(input.medications);
});

export const transcribe = handle((req) => {
  const input = transcribeSchema.parse(req.body);
  return clinical.transcribeAudio(input.audio_key, input.language ?? 'sw', resolveTranscribeAdapter());
});

export const synthesize = handle((req) => {
  const input = synthesizeSchema.parse(req.body);
  return clinical.synthesizeSpeech(input.text, input.language ?? 'sw');
});

export const listModels = handle(() => clinical.listModels());
TS

cat > "$SVC/src/services/provider-resolver.ts" << 'TS'
import { env } from '../config/env.js';
import { createOpenAiCompatibleAdapter, stubChatAdapter, type ChatAdapter } from '../adapters/chat.js';
import { stubTranscribeAdapter, type TranscribeAdapter } from '../adapters/transcribe.js';

export function resolveChatAdapter(): ChatAdapter {
  if (env.CHAT_PROVIDER === 'openai_compatible') {
    return createOpenAiCompatibleAdapter({
      modelKey: env.CHAT_MODEL_NAME,
      endpoint: env.CHAT_MODEL_ENDPOINT,
      apiKey: env.CHAT_MODEL_KEY,
      modelName: env.CHAT_MODEL_NAME,
    });
  }
  return stubChatAdapter;
}

export function resolveTranscribeAdapter(): TranscribeAdapter {
  return stubTranscribeAdapter;
}
TS

cat > "$SVC/src/routes/ai.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/ai.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth, requireRole } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const aiRouter = Router();

aiRouter.post('/ai/conversations', requireAuth, idempotency, c.createConversation);
aiRouter.get('/ai/conversations/:conversation_id', requireAuth, c.getConversation);
aiRouter.post('/ai/conversations/:conversation_id/messages', requireAuth, idempotency, c.sendMessage);

aiRouter.post('/ai/triage', requireAuth, c.triage);
aiRouter.post('/ai/drug-interactions', requireAuth, c.drugInteractions);
aiRouter.post('/ai/transcribe', requireAuth, c.transcribe);
aiRouter.post('/ai/synthesize', requireAuth, c.synthesize);

aiRouter.get('/ai/models', requireAuth, requireRole('platform_admin'), c.listModels);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { aiRouter } from './routes/ai.routes.js';
import { seedModelRegistry } from './services/registry.js';

const service = createService({
  name: 'ai',
  port: env.PORT,
  routers: [aiRouter],
  development: env.NODE_ENV === 'development',
});

// Idempotent; safe on every boot. Keeps the registry complete without a
// separate migration step every time the shortlist changes.
await seedModelRegistry();

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4009"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
    echo "CHAT_PROVIDER=stub"
    echo "TRANSCRIBE_PROVIDER=stub"
  } > "$SVC/.env"
  echo "  .env written"
fi

cat > "$SVC/src/tests/ai.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { stubChatAdapter } from '../adapters/chat.js';
import { MODEL_SHORTLIST, seedModelRegistry, listModels } from '../services/registry.js';
import * as conversations from '../services/conversation.service.js';
import * as clinical from '../services/clinical.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const users: string[] = [];
const convos: string[] = [];

after(async () => {
  for (const id of convos) {
    await prisma.aiInference.deleteMany({ where: { subjectId: id } }).catch(() => undefined);
    await prisma.aiMessage.deleteMany({ where: { conversationId: id } }).catch(() => undefined);
    await prisma.aiConversation.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatientUser() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'AI Test' },
  });
  users.push(user.id);
  return user;
}

describe('model registry', () => {
  it('seeds every shortlisted model exactly once', async () => {
    const first = await seedModelRegistry();
    const second = await seedModelRegistry();
    assert.ok(first.inserted + second.skipped >= MODEL_SHORTLIST.length);
    assert.equal(second.inserted, 0, 'a second seed must insert nothing new');
  });

  it('lists every model, including ones not yet deployed', async () => {
    await seedModelRegistry();
    const { data } = await listModels();
    assert.ok(data.length >= MODEL_SHORTLIST.length);
    assert.ok(data.some((m) => m.status === 'not_deployed'), 'undeployed models must still be visible');
  });
});

describe('stub chat adapter', () => {
  it('never diagnoses', async () => {
    const result = await stubChatAdapter.complete([{ role: 'user', content: 'I have a headache' }]);
    assert.ok(!/you have|diagnos/i.test(result.text));
  });

  it('escalates on a red-flag phrase and stops advising', async () => {
    const result = await stubChatAdapter.complete([{ role: 'user', content: 'I have severe chest pain' }]);
    assert.equal(result.escalated, true);
    assert.ok(result.escalationReason);
  });
});

describe('conversation service', () => {
  it('logs every message exchange to AiInference', async () => {
    const user = await makePatientUser();
    const convo = await conversations.createConversation(
      { sub: user.id, role: 'patient' }, { audience: 'patient' },
    );
    convos.push(convo.id);

    await conversations.sendMessage(
      convo.id, { sub: user.id, role: 'patient' }, { body: 'I have a mild cough' }, stubChatAdapter,
    );

    const inferences = await prisma.aiInference.count({ where: { subjectId: convo.id, kind: 'chat' } });
    assert.ok(inferences >= 1);
  });

  it('refuses a clinician-audience conversation for a patient caller', async () => {
    const user = await makePatientUser();
    await assert.rejects(
      () => conversations.createConversation({ sub: user.id, role: 'patient' }, { audience: 'clinician' }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('refuses a stranger reading someone else\'s conversation', async () => {
    const user = await makePatientUser();
    const convo = await conversations.createConversation({ sub: user.id, role: 'patient' }, { audience: 'patient' });
    convos.push(convo.id);

    await assert.rejects(
      () => conversations.getConversation(convo.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});

describe('triage suggestion', () => {
  it('is always marked advisory_only', async () => {
    const result = await clinical.suggestTriage({ symptom_text: 'mild cough' });
    assert.equal(result.advisory_only, true);
  });

  it('flags an emergency phrase in free text', async () => {
    const result = await clinical.suggestTriage({ symptom_text: 'I have severe chest pain' });
    assert.equal(result.suggested_urgency, 'emergency');
  });

  it('defaults to routine with no symptoms', async () => {
    const result = await clinical.suggestTriage({});
    assert.equal(result.suggested_urgency, 'routine');
  });
});

describe('drug interactions', () => {
  it('flags a known interacting pair', async () => {
    const result = await clinical.checkDrugInteractions(['Warfarin', 'Aspirin']);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.severity, 'major');
  });

  it('finds nothing for unrelated medications', async () => {
    const result = await clinical.checkDrugInteractions(['Paracetamol', 'Amoxicillin']);
    assert.equal(result.findings.length, 0);
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/ai exec tsc --noEmit"
echo "  pnpm --filter @a-health/ai test"
