#!/usr/bin/env bash
#
# Builds services/messaging, plus the two pieces it needs that did not exist:
#
#   * an event bus, so one service can tell another that something happened.
#     Backed by Postgres LISTEN/NOTIFY — no new container, and everything
#     needed is already running. The interface is the point: swapping in Redis
#     later touches one file.
#
#   * short-lived realtime tickets, because the browser WebSocket API cannot
#     send an Authorization header.
#
# Messaging is what makes "follow-up till cure" real: the conversation is
# scoped to the care thread, so it survives the consultation closing.
#
# Run from the repo root:
#   bash setup-messaging-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/messaging"
HTTP="$ROOT/packages/http"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$HTTP/src/index.ts" ] || { echo "packages/http missing."; exit 1; }
[ -f "$SCHEMA" ] || { echo "schema.prisma missing."; exit 1; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,realtime,types,tests}

# ===========================================================================
# 1. Schema — realtime tickets
# ===========================================================================
cp "$SCHEMA" "$SCHEMA.bak"
node - "$SCHEMA" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('model RealtimeTicket')) {
  console.log('  schema already has RealtimeTicket');
  process.exit(0);
}

s = s.trimEnd() + '\n' + `
/// Single-use, sixty-second ticket for the WebSocket handshake.
///
/// Stored rather than signed because a ticket travels in a query string, and
/// query strings end up in access logs and proxy logs. Single use means a
/// ticket recovered from a log is already spent.
model RealtimeTicket {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  ticketHash String    @unique @map("ticket_hash") @db.VarChar(255)
  deviceId   String?   @map("device_id") @db.VarChar(128)
  expiresAt  DateTime  @map("expires_at")
  consumedAt DateTime? @map("consumed_at")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([expiresAt])
  @@map("realtime_tickets")
}
`;

const re = /(model User \{[\s\S]*?)(\n\})/;
if (!re.test(s)) { console.error('  User model not found'); process.exit(1); }
s = s.replace(re, (_m, body, close) => body + '\n  realtimeTickets RealtimeTicket[]' + close);

fs.writeFileSync(p, s);
console.log('  schema: RealtimeTicket added');
NODE

# ===========================================================================
# 2. packages/http — event bus
# ===========================================================================
cat > "$HTTP/src/events.ts" << 'TS'
import { Client } from 'pg';
import { createLogger } from '@a-health/logger';

const logger = createLogger('events');
const CHANNEL = 'ahealth_events';

/**
 * What one service tells the others.
 *
 * `audienceUserIds` is computed by the publisher, not the subscriber. The
 * service that owns the data is the only one that knows who is entitled to
 * hear about it, and working that out at the delivery end would mean the
 * realtime layer needing read access to every domain.
 */
export interface DomainEvent {
  event:
    | 'consultation.assigned'
    | 'consultation.escalated'
    | 'consultation.completed'
    | 'consultation.message'
    | 'checkin.deviation'
    | 'emergency.dispatched'
    | 'device.alert';
  entity: string;
  id: string;
  version?: number;
  careThreadId?: string | null;
  audienceUserIds: string[];
  data?: Record<string, unknown>;
}

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(handler: (event: DomainEvent) => void): Promise<void>;
  close(): Promise<void>;
}

/**
 * Postgres LISTEN/NOTIFY.
 *
 * Chosen over Redis because the database is already there, and one fewer
 * moving part in a pilot is worth more than headroom nobody is using yet.
 *
 * Its limits are real and worth stating: the payload cap is 8000 bytes,
 * nothing is persisted, and a subscriber that is down misses what was sent
 * while it was down. None of that matters for realtime nudges — the client
 * refetches on reconnect and the database remains the source of truth — but it
 * would matter for anything that must not be missed. Those go through a table
 * and a worker, not through here.
 */
export function createPostgresEventBus(connectionString: string): EventBus {
  let publisher: Client | null = null;
  let listener: Client | null = null;

  async function getPublisher(): Promise<Client> {
    if (publisher) return publisher;
    publisher = new Client({ connectionString });
    await publisher.connect();
    return publisher;
  }

  return {
    async publish(event) {
      let payload = JSON.stringify(event);

      // Over the cap, drop the body and keep the pointer. The client already
      // knows how to fetch; it does not know how to recover a truncated event.
      if (Buffer.byteLength(payload) > 7000) {
        payload = JSON.stringify({ ...event, data: { truncated: true } });
      }

      try {
        const client = await getPublisher();
        await client.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
      } catch (err) {
        // A dropped notification must never fail the write that caused it. The
        // record is committed; the nudge is best effort.
        logger.warn('publish failed', { event: event.event, err: String(err) });
      }
    },

    async subscribe(handler) {
      listener = new Client({ connectionString });
      await listener.connect();
      await listener.query(`LISTEN ${CHANNEL}`);

      listener.on('notification', (msg) => {
        if (!msg.payload) return;
        try {
          handler(JSON.parse(msg.payload) as DomainEvent);
        } catch (err) {
          logger.warn('undeliverable payload', { err: String(err) });
        }
      });

      listener.on('error', (err) => {
        logger.error('listener error, reconnecting', { err: String(err) });
        setTimeout(() => {
          void this.subscribe(handler).catch(() => undefined);
        }, 2000);
      });

      logger.info('subscribed', { channel: CHANNEL });
    },

    async close() {
      await publisher?.end().catch(() => undefined);
      await listener?.end().catch(() => undefined);
      publisher = null;
      listener = null;
    },
  };
}
TS

node - "$HTTP/src/index.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('./events.js')) {
  s = s.replace("export * from './params.js';", "export * from './params.js';\nexport * from './events.js';");
  fs.writeFileSync(p, s);
  console.log('  events exported from packages/http');
}
NODE

# createService must hand back the http.Server so a WebSocket server can attach.
node - "$HTTP/src/createService.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('start(): Server')) { console.log('  createService already returns the server'); process.exit(0); }

let n = 0;
if (s.includes("import express, { type Express, type Router } from 'express';")) {
  s = s.replace(
    "import express, { type Express, type Router } from 'express';",
    "import type { Server } from 'node:http';\nimport express, { type Express, type Router } from 'express';");
  n++;
}
if (s.includes('  start(): void;')) {
  s = s.replace('  start(): void;', '  /** Returns the underlying server so a WebSocket server can attach to it. */\n  start(): Server;');
  n++;
}
if (s.includes('      const server = app.listen(options.port, () => {')) {
  s = s.replace('    start() {', '    start(): Server {');
  n++;
}
if (s.includes('      }\n    },\n  };\n}')) {
  s = s.replace('      }\n    },\n  };\n}', '      }\n\n      return server;\n    },\n  };\n}');
  n++;
}
fs.writeFileSync(p, s);
console.log(`  createService patched (${n} edits)`);
NODE

node - "$HTTP/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
pkg.dependencies = { ...(pkg.dependencies || {}), pg: '^8.13.0' };
pkg.devDependencies = { ...(pkg.devDependencies || {}), '@types/pg': '^8.11.10' };
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('  pg added to packages/http');
NODE

# ===========================================================================
# 3. services/messaging
# ===========================================================================
node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/messaging';
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
  dotenv: '^17.4.2', express: '^5.1.0', ws: '^8.18.0', zod: '^4.4.3' };
pkg.devDependencies = { ...(pkg.devDependencies || {}),
  '@types/express': '^5.0.3', '@types/node': '^22.10.0', '@types/ws': '^8.5.13',
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
  PORT: z.coerce.number().default(4006),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** Ticket lifetime. Long enough to open a socket, short enough to be useless in a log. */
  REALTIME_TICKET_TTL_SECONDS: z.coerce.number().default(60),
  /** Sockets are closed if a pong is not seen within this window. */
  WS_HEARTBEAT_SECONDS: z.coerce.number().default(30),
  PUBLIC_WS_URL: z.string().default('ws://localhost:4006/realtime'),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/types/message.types.ts" << 'TS'
import { z } from 'zod';

export const listMessagesQuery = z.object({
  consultation_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createMessageSchema = z
  .object({
    body: z.string().max(4000).optional(),
    attachment_key: z.string().max(500).optional(),
    attachment_type: z.enum(['voice_note', 'image', 'document']).optional(),
    client_created_at: z.string().datetime().optional(),
  })
  // An empty message is not a message. Rejecting it here keeps the thread free
  // of blanks that a patient cannot tell apart from a failed send.
  .refine((v) => Boolean(v.body?.trim()) || Boolean(v.attachment_key), {
    message: 'Provide a body or an attachment',
    path: ['body'],
  });

export const markReadSchema = z.object({
  up_to_message_id: z.string().uuid(),
});
TS

cat > "$SVC/src/services/message.service.ts" << 'TS'
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
TS

cat > "$SVC/src/services/realtime.service.ts" << 'TS'
import { randomBytes } from 'node:crypto';
import { prisma } from '@a-health/database';
import { sha256, unauthenticated } from '@a-health/http';
import { env } from '../config/env.js';

/**
 * Mints a single-use ticket for the WebSocket handshake.
 *
 * The browser WebSocket API cannot set an Authorization header, so the
 * credential has to travel in the URL — and URLs end up in access logs, proxy
 * logs and browser history. Sixty seconds and single use mean a ticket
 * recovered from a log is already spent.
 */
export async function issueTicket(userId: string, deviceId?: string) {
  const ticket = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REALTIME_TICKET_TTL_SECONDS * 1000);

  await prisma.realtimeTicket.create({
    data: { userId, ticketHash: sha256(ticket), deviceId: deviceId ?? null, expiresAt },
  });

  return {
    ticket,
    expires_at: expiresAt.toISOString(),
    url: env.PUBLIC_WS_URL,
  };
}

/** Redeems a ticket. The conditional update is the single-use guarantee. */
export async function redeemTicket(ticket: string): Promise<string> {
  const hash = sha256(ticket);
  const row = await prisma.realtimeTicket.findUnique({ where: { ticketHash: hash } });
  if (!row) throw unauthenticated('TOKEN_INVALID', 'Ticket is not valid');
  if (row.expiresAt < new Date()) throw unauthenticated('TOKEN_EXPIRED', 'Ticket has expired');

  const consumed = await prisma.realtimeTicket.updateMany({
    where: { ticketHash: hash, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw unauthenticated('TOKEN_INVALID', 'Ticket has already been used');

  return row.userId;
}

/** Expired and spent tickets are worthless within a minute; sweep them hourly. */
export async function sweepTickets(now = new Date()): Promise<number> {
  const result = await prisma.realtimeTicket.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 3600_000) } },
  });
  return result.count;
}
TS

cat > "$SVC/src/realtime/server.ts" << 'TS'
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createLogger } from '@a-health/logger';
import type { EventBus } from '@a-health/http';
import { env } from '../config/env.js';
import { redeemTicket } from '../services/realtime.service.js';

const logger = createLogger('messaging.ws');

interface Socket extends WebSocket {
  userId?: string;
  alive?: boolean;
}

/**
 * Holds the open sockets and routes events to them.
 *
 * One user, many sockets: a clinician with the console open on a desktop and
 * the app open on a phone must see the same case appear on both.
 *
 * Delivery here is best effort by design. Every event carries entity, id and
 * version so a client that missed one refetches and reconciles; the database
 * stays the source of truth, and nothing clinical depends on a socket having
 * been open.
 */
export function attachRealtime(server: Server, bus: EventBus): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/realtime' });
  const sockets = new Map<string, Set<Socket>>();

  wss.on('connection', (raw, request) => {
    const socket = raw as Socket;
    void (async () => {
      try {
        const url = new URL(request.url ?? '', 'http://localhost');
        const ticket = url.searchParams.get('ticket');
        if (!ticket) {
          socket.close(4401, 'ticket required');
          return;
        }

        const userId = await redeemTicket(ticket);
        socket.userId = userId;
        socket.alive = true;

        let set = sockets.get(userId);
        if (!set) {
          set = new Set();
          sockets.set(userId, set);
        }
        set.add(socket);

        socket.on('pong', () => {
          socket.alive = true;
        });

        socket.on('close', () => {
          const current = sockets.get(userId);
          current?.delete(socket);
          if (current && current.size === 0) sockets.delete(userId);
        });

        socket.send(JSON.stringify({ event: 'connected', server_time: new Date().toISOString() }));
        logger.info('socket open', { userId, openForUser: set.size });
      } catch {
        // No detail on the wire. A failed handshake must not tell a caller
        // whether the ticket was unknown, expired, or already spent.
        socket.close(4401, 'unauthorised');
      }
    })();
  });

  // A socket on a mobile network can die without a close frame. Without this
  // the map fills with connections that will never receive anything.
  const heartbeat = setInterval(() => {
    for (const set of sockets.values()) {
      for (const socket of set) {
        if (!socket.alive) {
          socket.terminate();
          continue;
        }
        socket.alive = false;
        socket.ping();
      }
    }
  }, env.WS_HEARTBEAT_SECONDS * 1000);
  heartbeat.unref();

  void bus.subscribe((event) => {
    const payload = JSON.stringify(event);
    let delivered = 0;
    for (const userId of event.audienceUserIds) {
      for (const socket of sockets.get(userId) ?? []) {
        if (socket.readyState === socket.OPEN) {
          socket.send(payload);
          delivered += 1;
        }
      }
    }
    logger.debug('event routed', { event: event.event, delivered });
  });

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
TS

cat > "$SVC/src/controllers/message.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam, type EventBus } from '@a-health/http';
import * as messages from '../services/message.service.js';
import { issueTicket } from '../services/realtime.service.js';
import { createMessageSchema, listMessagesQuery, markReadSchema } from '../types/message.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid,
});
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req, res));
    } catch (err) {
      next(err);
    }
  };

export function buildControllers(bus: EventBus) {
  return {
    list: handle((req) =>
      messages.listMessages(pathParam(req, 'care_thread_id'), caller(req), listMessagesQuery.parse(req.query))),

    create: handle(
      (req, res) => messages.createMessage(
        pathParam(req, 'care_thread_id'), caller(req),
        createMessageSchema.parse(req.body), bus, meta(req, res),
      ),
      201,
    ),

    markRead: handle((req) => {
      const input = markReadSchema.parse(req.body);
      return messages.markRead(pathParam(req, 'care_thread_id'), caller(req), input.up_to_message_id);
    }),

    realtimeToken: handle((req) => issueTicket(req.auth!.sub, req.auth!.did), 201),
  };
}
TS

cat > "$SVC/src/routes/message.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService, type EventBus } from '@a-health/http';
import { env } from '../config/env.js';
import { buildControllers } from '../controllers/message.controller.js';

export function buildRouter(bus: EventBus): Router {
  const tokens = createTokenService({
    secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  const { requireAuth } = createAuthGuards(tokens);
  const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);
  const c = buildControllers(bus);

  const router = Router();
  router.get('/care-threads/:care_thread_id/messages', requireAuth, c.list);
  router.post('/care-threads/:care_thread_id/messages', requireAuth, idempotency, c.create);
  router.post('/care-threads/:care_thread_id/messages/read', requireAuth, c.markRead);
  router.post('/realtime/token', requireAuth, c.realtimeToken);
  return router;
}
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createPostgresEventBus, createService } from '@a-health/http';
import { env } from './config/env.js';
import { buildRouter } from './routes/message.routes.js';
import { attachRealtime } from './realtime/server.js';
import { sweepTickets } from './services/realtime.service.js';

const bus = createPostgresEventBus(env.DATABASE_URL);

const service = createService({
  name: 'messaging',
  port: env.PORT,
  routers: [buildRouter(bus)],
  development: env.NODE_ENV === 'development',
  onShutdown: () => bus.close(),
});

const server = service.start();
attachRealtime(server, bus);

const sweep = setInterval(() => {
  void sweepTickets().catch(() => undefined);
}, 3600_000);
sweep.unref();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4006"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
    echo "PUBLIC_WS_URL=ws://localhost:4006/realtime"
  } > "$SVC/.env"
  echo "  .env written"
fi

cat > "$SVC/src/tests/realtime.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { issueTicket, redeemTicket, sweepTickets } from '../services/realtime.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const created: string[] = [];

after(async () => {
  for (const id of created) {
    await prisma.realtimeTicket.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeUser() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: 'patient',
      status: 'active',
      fullName: 'Ticket Test',
    },
  });
  created.push(user.id);
  return user;
}

describe('realtime tickets', () => {
  it('redeems once and returns the owner', async () => {
    const user = await makeUser();
    const { ticket } = await issueTicket(user.id, 'device-1');
    assert.equal(await redeemTicket(ticket), user.id);
  });

  it('refuses a second redemption', async () => {
    const user = await makeUser();
    const { ticket } = await issueTicket(user.id);
    await redeemTicket(ticket);

    // A ticket travels in a query string and query strings end up in logs.
    // One recovered from a log has to be worthless.
    await assert.rejects(
      () => redeemTicket(ticket),
      (e: AppError) => e.code === 'TOKEN_INVALID',
    );
  });

  it('refuses an expired ticket', async () => {
    const user = await makeUser();
    const { ticket } = await issueTicket(user.id);
    await prisma.realtimeTicket.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await assert.rejects(
      () => redeemTicket(ticket),
      (e: AppError) => e.code === 'TOKEN_EXPIRED',
    );
  });

  it('refuses an unknown ticket', async () => {
    await assert.rejects(
      () => redeemTicket(randomUUID()),
      (e: AppError) => e.code === 'TOKEN_INVALID',
    );
  });

  it('never stores the ticket in the clear', async () => {
    const user = await makeUser();
    const { ticket } = await issueTicket(user.id);
    const row = await prisma.realtimeTicket.findFirstOrThrow({ where: { userId: user.id } });
    assert.notEqual(row.ticketHash, ticket);
    assert.equal(row.ticketHash.length, 64);
  });

  it('sweeps tickets that are long past use', async () => {
    const user = await makeUser();
    await issueTicket(user.id);
    await prisma.realtimeTicket.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 7200_000) },
    });
    assert.ok((await sweepTickets()) >= 1);
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/database exec prisma format"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name realtime_tickets"
echo "  pnpm --filter @a-health/messaging exec tsc --noEmit"
echo "  pnpm --filter @a-health/messaging test"
