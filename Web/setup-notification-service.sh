#!/usr/bin/env bash
#
# Closes two open seams:
#
#   1. services/consultation never published to the event bus, so nothing was
#      pushed in realtime when a case was assigned, escalated or completed.
#
#   2. NotificationLog rows were being written and never drained, so SMS never
#      reached anyone — and a feature-phone user is precisely who this platform
#      exists to reach.
#
# Also adds NotificationLog.deliverAfter, which is what stops the platform
# sending an SMS for a message the recipient already read in the app.
#
# Run from the repo root:
#   bash setup-notification-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/notification"
CONS="$ROOT/services/consultation"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SCHEMA" ] || { echo "schema.prisma missing."; exit 1; }
[ -f "$CONS/src/services/consultation.service.ts" ] || { echo "services/consultation missing."; exit 1; }

mkdir -p "$SVC/src"/{config,providers,services,workers,tests}

# ===========================================================================
# 1. Schema — deliverAfter
# ===========================================================================
cp "$SCHEMA" "$SCHEMA.bak"
node - "$SCHEMA" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('deliverAfter')) { console.log('  schema already has deliverAfter'); process.exit(0); }

const re = /(\n(\s*)attempts\s+Int[^\n]*)/;
if (!re.test(s)) { console.error('  NotificationLog anchor not found'); process.exit(1); }

s = s.replace(re, (_m, line, indent) =>
  `${line}\n\n${indent}/// Hold the notification until this time. An in-app message that the\n` +
  `${indent}/// recipient reads within the grace window is never sent again over SMS —\n` +
  `${indent}/// without this the platform would charge itself, and annoy the patient,\n` +
  `${indent}/// for every message they had already seen.\n` +
  `${indent}deliverAfter DateTime? @map("deliver_after")`);

fs.writeFileSync(p, s);
console.log('  schema: NotificationLog.deliverAfter added');
NODE

# ===========================================================================
# 2. services/consultation — publish domain events
# ===========================================================================
cat > "$CONS/src/events.ts" << 'TS'
import { prisma } from '@a-health/database';
import { createPostgresEventBus, type DomainEvent } from '@a-health/http';
import { env } from './config/env.js';

export const bus = createPostgresEventBus(env.DATABASE_URL);

/**
 * Who is entitled to hear about a consultation: the patient, their guardian,
 * and the assigned clinician.
 *
 * Worked out here rather than at the delivery end. The service that owns the
 * data is the only one that knows who may hear about it, and computing it in
 * the realtime layer would mean that layer needing read access to every
 * domain it forwards for.
 */
export async function audienceFor(consultationId: string): Promise<string[]> {
  const c = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
    select: {
      patient: { select: { userId: true, guardianUserId: true } },
      assignedClinician: { select: { userId: true } },
    },
  });
  if (!c) return [];
  return [
    c.patient.userId,
    c.patient.guardianUserId,
    c.assignedClinician?.userId ?? null,
  ].filter((id): id is string => Boolean(id));
}

/** Best effort. A dropped notification must never fail the write that caused it. */
export async function publishConsultationEvent(
  event: DomainEvent['event'],
  consultationId: string,
  careThreadId: string,
  version: number,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const audienceUserIds = await audienceFor(consultationId);
    if (audienceUserIds.length === 0) return;
    await bus.publish({
      event,
      entity: 'consultation_requests',
      id: consultationId,
      version,
      careThreadId,
      audienceUserIds,
      data,
    });
  } catch {
    /* the record is committed; the nudge is not load-bearing */
  }
}
TS

node - "$CONS/src/services/consultation.service.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('publishConsultationEvent')) { console.log('  consultation already publishes'); process.exit(0); }

function must(needle, replacement, label) {
  if (!s.includes(needle)) { console.error(`  anchor missing: ${label}`); process.exit(1); }
  s = s.replace(needle, replacement);
}

must(
  "import type { Caller, Meta } from './careThread.service.js';",
  "import type { Caller, Meta } from './careThread.service.js';\nimport { publishConsultationEvent } from '../events.js';",
  'import',
);

// accept
must(
  `  const updated = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: consultationId } });
  return serialiseConsultation(updated);
}

/** Declining does not stop the SLA clock`,
  `  const updated = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: consultationId } });

  await publishConsultationEvent(
    'consultation.assigned', consultationId, updated.careThreadId, updated.version,
    { clinician_id: cpid },
  );

  return serialiseConsultation(updated);
}

/** Declining does not stop the SLA clock`,
  'accept publish',
);

// complete
must(
  `  return {
    consultation: serialiseConsultation(result.completed),`,
  `  await publishConsultationEvent(
    'consultation.completed', consultationId, consultation.careThreadId, result.completed.version,
    { prescribed: result.prescriptionId !== null, follow_up: result.followUpCycleId !== null },
  );

  return {
    consultation: serialiseConsultation(result.completed),`,
  'complete publish',
);

fs.writeFileSync(p, s);
console.log('  consultation: assigned + completed events wired');
NODE

node - "$CONS/src/workers/sla.worker.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('publishConsultationEvent')) { console.log('  sla worker already publishes'); process.exit(0); }

const imp = "import { offerConsultation } from '../services/consultation.service.js';";
if (!s.includes(imp)) { console.error('  sla import anchor missing'); process.exit(1); }
s = s.replace(imp, imp + "\nimport { publishConsultationEvent } from '../events.js';");

const anchor = `    logger.warn('sla breached', {`;
if (!s.includes(anchor)) { console.error('  sla log anchor missing'); process.exit(1); }
s = s.replace(anchor,
  `    await publishConsultationEvent(
      'consultation.escalated', consultation.id, consultation.careThreadId,
      consultation.version + 1, { escalationCount },
    );

` + anchor);

fs.writeFileSync(p, s);
console.log('  sla worker: escalated event wired');
NODE

node - "$CONS/src/index.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('onShutdown')) { console.log('  consultation index already closes the bus'); process.exit(0); }
s = s.replace(
  "import { startSlaWorker } from './workers/sla.worker.js';",
  "import { startSlaWorker } from './workers/sla.worker.js';\nimport { bus } from './events.js';");
s = s.replace(
  '  development: env.NODE_ENV === \'development\',\n});',
  '  development: env.NODE_ENV === \'development\',\n  onShutdown: () => bus.close(),\n});');
fs.writeFileSync(p, s);
console.log('  consultation index: bus closed on shutdown');
NODE

# ===========================================================================
# 3. services/notification
# ===========================================================================
node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/notification';
pkg.version = pkg.version || '1.0.0';
pkg.private = true;
pkg.type = 'module';
pkg.main = pkg.main || './src/index.ts';
pkg.scripts = { ...(pkg.scripts || {}),
  dev: 'tsx watch src/index.ts', build: 'tsc --noEmit',
  start: 'node --import tsx src/index.ts',
  test: 'node --import tsx --test src/tests/*.test.ts' };
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
  PORT: z.coerce.number().default(4008),
  DATABASE_URL: z.string(),

  /** `console` prints instead of sending. Anything else needs a gateway URL. */
  SMS_PROVIDER: z.enum(['console', 'http']).default('console'),
  SMS_GATEWAY_URL: z.string().default(''),
  SMS_GATEWAY_KEY: z.string().default(''),
  SMS_SENDER_ID: z.string().default('A-HEALTH'),

  DISPATCH_INTERVAL_SECONDS: z.coerce.number().default(10),
  DISPATCH_BATCH_SIZE: z.coerce.number().default(50),

  /**
   * How long an in-app message is given to be read before it is also sent by
   * SMS. Long enough that someone with the app open is not charged for a
   * duplicate; short enough that someone who never opens it is not left
   * waiting.
   */
  MESSAGE_SMS_GRACE_SECONDS: z.coerce.number().default(180),

  MAX_ATTEMPTS: z.coerce.number().default(4),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
  throw new Error('SMS_PROVIDER=console cannot be used in production — nothing would be sent.');
}
TS

cat > "$SVC/src/providers/index.ts" << 'TS'
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('notification.provider');

export interface SendResult {
  ok: boolean;
  providerRef?: string;
  failureCode?: string;
  /** False for anything permanent — a wrong number is not worth four attempts. */
  retryable?: boolean;
}

export interface NotificationProvider {
  readonly name: string;
  send(to: string, body: string): Promise<SendResult>;
}

/** Development. Prints the message so a flow can be followed without a gateway. */
export const consoleProvider: NotificationProvider = {
  name: 'console',
  async send(to, body) {
    logger.info('sms (console)', { to: to.slice(0, 6) + '****', length: body.length });
    // The number is masked and the body is never printed. A development log is
    // still a log, and clinical text does not belong in one.
    return { ok: true, providerRef: 'console-' + Date.now() };
  },
};

/**
 * Generic HTTP gateway, shaped for the aggregators used in the region. The
 * exact payload differs per provider; this is the seam to adapt, not the
 * calling code.
 */
export const httpProvider: NotificationProvider = {
  name: 'http',
  async send(to, body) {
    try {
      const response = await fetch(env.SMS_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.SMS_GATEWAY_KEY}`,
        },
        body: JSON.stringify({ to, from: env.SMS_SENDER_ID, message: body }),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { id?: string };
        return { ok: true, providerRef: payload.id };
      }

      // 4xx from the gateway means the request itself is wrong — a malformed
      // number, an unfunded account. Retrying cannot fix either.
      const retryable = response.status >= 500 || response.status === 429;
      return { ok: false, failureCode: `HTTP_${response.status}`, retryable };
    } catch (err) {
      return { ok: false, failureCode: 'NETWORK', retryable: true, providerRef: undefined };
    }
  },
};

export function resolveProvider(): NotificationProvider {
  return env.SMS_PROVIDER === 'http' ? httpProvider : consoleProvider;
}
TS

cat > "$SVC/src/services/templates.ts" << 'TS'
/**
 * Message bodies, per language.
 *
 * Swahili first, and not as a translation of the English — a message read on a
 * feature phone in a rural ward is the primary case here, not the fallback.
 *
 * Kept under 160 characters wherever possible so one message is one SMS. Two
 * segments cost twice as much and arrive out of order often enough to matter.
 */

export type LanguageCode = 'sw' | 'en' | 'fr' | 'ha' | 'am';

type Template = (vars: Record<string, string>) => string;

const TEMPLATES: Record<string, Partial<Record<LanguageCode, Template>>> = {
  'thread.message': {
    sw: (v) => `A-health: ${v.sender ?? 'Daktari'} amekutumia ujumbe. Piga *150*88# au fungua app kusoma.`,
    en: (v) => `A-health: ${v.sender ?? 'Your clinician'} sent you a message. Dial *150*88# or open the app to read it.`,
  },
  'consultation.assigned': {
    sw: () => 'A-health: Daktari amepokea ombi lako. Fungua app au piga *150*88# kuendelea.',
    en: () => 'A-health: A clinician has picked up your request. Open the app or dial *150*88# to continue.',
  },
  'consultation.completed': {
    sw: () => 'A-health: Matibabu yako yamekamilika. Angalia ushauri na dawa kwenye app au *150*88#.',
    en: () => 'A-health: Your consultation is complete. See the advice and prescription in the app or on *150*88#.',
  },
  'adherence.reminder': {
    sw: (v) => `A-health: Ni wakati wa ${v.medication ?? 'dawa'} ${v.dosage ?? ''}. Jibu 1 umemeza, 2 hujameza.`.trim(),
    en: (v) => `A-health: Time for ${v.medication ?? 'your medicine'} ${v.dosage ?? ''}. Reply 1 if taken, 2 if not.`.trim(),
  },
  'checkin.due': {
    sw: () => 'A-health: Ni wakati wa kujibu maswali ya ufuatiliaji. Piga *150*88# au fungua app.',
    en: () => 'A-health: Time for your follow-up check-in. Dial *150*88# or open the app.',
  },
  'screening.invitation': {
    sw: (v) => `A-health: Umealikwa kupima ${v.programme ?? 'afya'}. Jibu 1 kukubali, 2 kukataa.`,
    en: (v) => `A-health: You are invited for ${v.programme ?? 'screening'}. Reply 1 to accept, 2 to decline.`,
  },
};

export function render(
  templateKey: string,
  language: LanguageCode,
  vars: Record<string, string> = {},
): string | null {
  const set = TEMPLATES[templateKey];
  if (!set) return null;
  // Falls back to Swahili, then English. A missing translation must never mean
  // a missing message.
  const template = set[language] ?? set.sw ?? set.en;
  return template ? template(vars) : null;
}

export const knownTemplates = Object.keys(TEMPLATES);
TS

cat > "$SVC/src/workers/dispatch.worker.ts" << 'TS'
import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';
import { resolveProvider } from '../providers/index.js';
import { render, type LanguageCode } from '../services/templates.js';

const logger = createLogger('notification.dispatch');

export interface DispatchResult {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Drains queued notifications.
 *
 * Two rules carry most of the weight:
 *
 * A message the recipient already read is not sent again. Without that check
 * every in-app conversation would also bill an SMS per message, and patients
 * would be woken by texts about messages they had answered an hour earlier.
 *
 * Permanent failures are not retried. A malformed number does not become valid
 * on the fourth attempt, and burning the retry budget on it delays the
 * notifications that would have worked.
 */
export async function dispatchOnce(now = new Date()): Promise<DispatchResult> {
  const provider = resolveProvider();

  const queued = await prisma.notificationLog.findMany({
    where: {
      status: 'queued',
      attempts: { lt: env.MAX_ATTEMPTS },
      OR: [{ deliverAfter: null }, { deliverAfter: { lte: now } }],
    },
    include: {
      user: { select: { phoneNumber: true, preferredLanguage: true, fullName: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: env.DISPATCH_BATCH_SIZE,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of queued) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;

    if (row.user.status !== 'active') {
      await mark(row.id, 'failed', { failureCode: 'ACCOUNT_INACTIVE' });
      skipped += 1;
      continue;
    }

    // Superseded: the recipient opened the app and read it. Nothing to send.
    if (row.templateKey === 'thread.message' && typeof payload.messageId === 'string') {
      const message = await prisma.message.findUnique({
        where: { id: payload.messageId },
        select: { readAt: true },
      });
      if (message?.readAt) {
        await mark(row.id, 'delivered', { failureCode: 'SUPERSEDED_READ' });
        skipped += 1;
        continue;
      }
    }

    const body = render(
      row.templateKey,
      row.user.preferredLanguage as LanguageCode,
      Object.fromEntries(
        Object.entries(payload).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>,
    );

    if (!body) {
      // An unknown template is a bug, not a transient failure. Fail it loudly
      // rather than retrying something that will never render.
      logger.error('unknown template', { templateKey: row.templateKey, id: row.id });
      await mark(row.id, 'failed', { failureCode: 'UNKNOWN_TEMPLATE' });
      failed += 1;
      continue;
    }

    const result = await provider.send(row.user.phoneNumber, body);

    if (result.ok) {
      await mark(row.id, 'sent', { providerRef: result.providerRef, sentAt: new Date() });
      sent += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    const permanent = result.retryable === false;
    const exhausted = attempts >= env.MAX_ATTEMPTS;

    await prisma.notificationLog.update({
      where: { id: row.id },
      data: {
        attempts,
        failureCode: result.failureCode ?? 'UNKNOWN',
        status: permanent || exhausted ? 'failed' : 'queued',
        // Exponential backoff. Retrying a struggling gateway immediately makes
        // it struggle harder.
        deliverAfter: permanent || exhausted
          ? null
          : new Date(now.getTime() + Math.min(2 ** attempts, 32) * 30_000),
      },
    });
    failed += 1;
  }

  return { sent, skipped, failed };
}

async function mark(
  id: string,
  status: 'sent' | 'delivered' | 'failed',
  extra: { providerRef?: string; failureCode?: string; sentAt?: Date } = {},
) {
  await prisma.notificationLog.update({
    where: { id },
    data: {
      status: status as never,
      providerRef: extra.providerRef ?? null,
      failureCode: extra.failureCode ?? null,
      sentAt: extra.sentAt ?? null,
      attempts: { increment: 1 },
    },
  });
}

export function startDispatchWorker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void dispatchOnce()
      .then((r) => {
        if (r.sent + r.failed > 0) logger.info('dispatch', r);
      })
      .catch((e) => logger.error('dispatch failed', { err: String(e) }));
  }, env.DISPATCH_INTERVAL_SECONDS * 1000);
  timer.unref();
  logger.info('dispatch worker started', {
    provider: env.SMS_PROVIDER,
    intervalSeconds: env.DISPATCH_INTERVAL_SECONDS,
  });
  return timer;
}
TS

cat > "$SVC/src/services/enqueue.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { env } from '../config/env.js';
import { knownTemplates } from './templates.js';

/**
 * The only way anything gets queued.
 *
 * Producers name a template and supply variables; they never write a message
 * body. That keeps every outbound string in one reviewed file, translatable,
 * and countable — and it is what makes it possible to answer "what exactly do
 * we send patients?" without grepping nine services.
 */
export async function enqueue(input: {
  userId: string;
  templateKey: string;
  vars?: Record<string, string>;
  /** Message templates default to a grace period so a read message is never resent. */
  deliverAfter?: Date;
}): Promise<string | null> {
  if (!knownTemplates.includes(input.templateKey)) {
    throw new Error(`Unknown notification template: ${input.templateKey}`);
  }

  const deliverAfter =
    input.deliverAfter ??
    (input.templateKey === 'thread.message'
      ? new Date(Date.now() + env.MESSAGE_SMS_GRACE_SECONDS * 1000)
      : null);

  const row = await prisma.notificationLog.create({
    data: {
      userId: input.userId,
      channel: 'sms',
      templateKey: input.templateKey,
      payload: (input.vars ?? {}) as never,
      deliverAfter,
    },
  });
  return row.id;
}
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { startDispatchWorker } from './workers/dispatch.worker.js';

// No routes of its own yet. Producers enqueue by writing a NotificationLog row;
// this process exists to drain it. The HTTP surface is here for /health, which
// is what tells you the queue is being worked at all.
const service = createService({
  name: 'notification',
  port: env.PORT,
  routers: [],
  development: env.NODE_ENV === 'development',
});

startDispatchWorker();
service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  {
    echo "NODE_ENV=development"
    echo "PORT=4008"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "SMS_PROVIDER=console"
    echo "SMS_SENDER_ID=A-HEALTH"
    echo "MESSAGE_SMS_GRACE_SECONDS=180"
  } > "$SVC/.env"
  echo "  .env written"
fi

cat > "$SVC/src/tests/dispatch.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { prisma } from '@a-health/database';
import { dispatchOnce } from '../workers/dispatch.worker.js';
import { render, knownTemplates } from '../services/templates.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const users: string[] = [];

after(async () => {
  for (const id of users) {
    await prisma.notificationLog.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeUser(language: 'sw' | 'en' = 'sw', status: 'active' | 'suspended' = 'active') {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: 'patient',
      status,
      fullName: 'Notify Test',
      preferredLanguage: language,
    },
  });
  users.push(user.id);
  return user;
}

describe('templates', () => {
  it('renders Swahili for every template', () => {
    for (const key of knownTemplates) {
      assert.ok(render(key, 'sw', { sender: 'Dkt', medication: 'x', dosage: '1', programme: 'y' }));
    }
  });

  it('falls back rather than returning nothing for an untranslated language', () => {
    // A missing translation must never mean a missing message.
    assert.ok(render('thread.message', 'ha', {}));
  });

  it('keeps messages to a single SMS segment', () => {
    for (const key of knownTemplates) {
      const body = render(key, 'sw', { sender: 'Dkt. Asha', medication: 'Amoxicillin', dosage: '500mg', programme: 'saratani' });
      assert.ok(body!.length <= 160, `${key} is ${body!.length} characters`);
    }
  });

  it('returns null for an unknown template', () => {
    assert.equal(render('does.not.exist', 'sw'), null);
  });
});

describe('dispatch', () => {
  it('sends a queued notification', async () => {
    const user = await makeUser();
    await prisma.notificationLog.create({
      data: { userId: user.id, channel: 'sms', templateKey: 'consultation.assigned', payload: {} },
    });

    const result = await dispatchOnce();
    assert.ok(result.sent >= 1);

    const row = await prisma.notificationLog.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(row.status, 'sent');
  });

  it('holds a notification until deliverAfter', async () => {
    const user = await makeUser();
    await prisma.notificationLog.create({
      data: {
        userId: user.id, channel: 'sms', templateKey: 'consultation.assigned',
        payload: {}, deliverAfter: new Date(Date.now() + 600_000),
      },
    });

    await dispatchOnce();
    const row = await prisma.notificationLog.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(row.status, 'queued', 'a held notification must not go early');
  });

  it('does not text a suspended account', async () => {
    const user = await makeUser('sw', 'suspended');
    await prisma.notificationLog.create({
      data: { userId: user.id, channel: 'sms', templateKey: 'consultation.assigned', payload: {} },
    });

    await dispatchOnce();
    const row = await prisma.notificationLog.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(row.status, 'failed');
    assert.equal(row.failureCode, 'ACCOUNT_INACTIVE');
  });

  it('fails an unknown template instead of retrying it forever', async () => {
    const user = await makeUser();
    await prisma.notificationLog.create({
      data: { userId: user.id, channel: 'sms', templateKey: 'not.a.template', payload: {} },
    });

    await dispatchOnce();
    const row = await prisma.notificationLog.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(row.status, 'failed');
    assert.equal(row.failureCode, 'UNKNOWN_TEMPLATE');
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/database exec prisma format"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name notification_deliver_after"
echo "  pnpm --filter @a-health/consultation exec tsc --noEmit"
echo "  pnpm --filter @a-health/notification exec tsc --noEmit"
echo "  pnpm --filter @a-health/notification test"
