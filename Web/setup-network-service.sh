#!/usr/bin/env bash
#
# Builds services/network — the professional community (blueprint §8):
# specialty communities, case discussion, and second-opinion requests
# connecting rural clinicians with specialists.
#
# The restored contract had create+reply+list for discussions but no way to
# read a single thread, and create-only for second opinions with no way to
# claim or answer one — a write path with no way to drive it through its own
# lifecycle, the same class of gap as doctor's missing admin queue and
# education's missing authoring endpoints. Patches the contract to add:
# GET /network/discussions/{id}, GET /network/second-opinions,
# POST .../claim, POST .../answer.
#
# Run from the repo root:
#   bash setup-network-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/network"
API="$ROOT/packages/api/openapi/a-health-api-v1.yaml"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

# ---------------------------------------------------------------------------
# Step 0: confirm every error code this service needs already exists.
# ---------------------------------------------------------------------------
ERRORS="$ROOT/packages/http/src/errors.ts"
for code in STATE_TRANSITION_INVALID NOT_RESOURCE_OWNER ROLE_NOT_PERMITTED NOT_FOUND FORBIDDEN VALIDATION_FAILED; do
  if ! grep -q "'$code'" "$ERRORS"; then
    echo "  MISSING ERROR CODE: $code — stopping before writing anything that would fail tsc"
    exit 1
  fi
done
echo "  confirmed: all required error codes already exist in packages/http"

# ---------------------------------------------------------------------------
# Contract patch: fill the read/lifecycle gaps the restore left.
# ---------------------------------------------------------------------------
BEFORE_PATHS=0
if [ -f "$API" ]; then
  BEFORE_PATHS=$(python3 -c "import yaml; print(len(yaml.safe_load(open('$API'))['paths']))")
  cp "$API" "$API.bak"
  python3 - "$API" << 'PYEOF'
import sys
path = sys.argv[1]
doc = open(path).read()

if 'getDiscussion' in doc:
    print('  contract already has network lifecycle endpoints')
else:
    anchor = "  /network/discussions/{discussion_id}/replies:"
    if anchor not in doc:
        print('  discussion-replies anchor not found; skipping contract patch (non-fatal)')
    else:
        GET_DISCUSSION = '''  /network/discussions/{discussion_id}:
    get:
      tags: [network]
      summary: Get a discussion with its replies
      description: |
        Never joins patient identity, even for a case discussion — what is
        shared is the clinical question, de-identified on the way in; this
        endpoint has no path back to who the patient is.
      operationId: getDiscussion
      parameters:
        - name: discussion_id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        '200':
          description: Discussion with replies
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Discussion'
                  - type: object
                    properties:
                      replies:
                        type: array
                        items: { $ref: '#/components/schemas/DiscussionReply' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }

  /network/discussions/{discussion_id}/replies:'''
        doc = doc.replace(anchor, GET_DISCUSSION, 1)

        anchor2 = "  /network/second-opinions:\n    post:"
        LIST_AND_LIFECYCLE = '''  /network/second-opinions:
    get:
      tags: [network]
      summary: List second-opinion requests
      description: |
        How a specialist finds open requests to claim. Store-and-forward by
        design — no requirement that requester and specialist are online at
        once, which is what makes specialist access work outside cities.
      operationId: listSecondOpinions
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [open, claimed, answered, withdrawn]
        - name: specialty
          in: query
          schema: { $ref: '#/components/schemas/Specialty' }
        - $ref: '#/components/parameters/Cursor'
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: Second opinions
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data:
                    type: array
                    items: { $ref: '#/components/schemas/SecondOpinion' }
                  meta: { $ref: '#/components/schemas/CursorMeta' }
    post:'''
        doc = doc.replace(anchor2, LIST_AND_LIFECYCLE, 1)

        anchor3 = "  # ----------------------------------------------------------------------\n  # Health education"
        if anchor3 not in doc:
            print('  health-education marker not found; claim/answer endpoints not added')
        else:
            CLAIM_ANSWER = '''  /network/second-opinions/{second_opinion_id}/claim:
    post:
      tags: [network]
      summary: Claim an open second-opinion request
      description: The specialist taking it on. Only legal while status is `open`.
      operationId: claimSecondOpinion
      parameters:
        - name: second_opinion_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '200':
          description: Claimed
          content:
            application/json:
              schema: { $ref: '#/components/schemas/SecondOpinion' }
        '409': { $ref: '#/components/responses/Conflict' }

  /network/second-opinions/{second_opinion_id}/answer:
    post:
      tags: [network]
      summary: Answer a claimed second-opinion request
      description: Only the clinician who claimed it may answer. Only legal while status is `claimed`.
      operationId: answerSecondOpinion
      parameters:
        - name: second_opinion_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [answer]
              properties:
                answer: { type: string, maxLength: 8000 }
      responses:
        '200':
          description: Answered
          content:
            application/json:
              schema: { $ref: '#/components/schemas/SecondOpinion' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { $ref: '#/components/responses/Conflict' }

'''
            doc = doc.replace(anchor3, CLAIM_ANSWER + anchor3, 1)

        open(path, 'w').write(doc)
        print('  contract: getDiscussion, listSecondOpinions, claimSecondOpinion, answerSecondOpinion added')
PYEOF

  python3 - "$API" "$BEFORE_PATHS" << 'PY'
import sys, re, yaml
p, before = sys.argv[1], int(sys.argv[2])
d = yaml.safe_load(open(p))
txt = open(p).read()
refs = set(re.findall(r"\$ref: '(#/[^']+)'", txt))
bad = []
for r in refs:
    n = d
    for part in r.lstrip('#/').split('/'):
        if isinstance(n, dict) and part in n: n = n[part]
        else: bad.append(r); break
ops = [o['operationId'] for pi in d['paths'].values() for k, o in pi.items() if isinstance(o, dict) and 'operationId' in o]
dupes = {o for o in ops if ops.count(o) > 1}
after = len(d['paths'])
print(f"  contract check: paths {before} -> {after} | refs broken: {bad or 'none'} | duplicate ops: {dupes or 'none'}")
if bad or dupes: sys.exit(1)
PY
fi

mkdir -p "$SVC/src"/{config,routes,controllers,services,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/network';
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
  PORT: z.coerce.number().default(4017),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/types/network.types.ts" << 'TS'
import { z } from 'zod';

export const listDiscussionsQuery = z.object({
  community_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const createDiscussionSchema = z.object({
  community_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  is_case_discussion: z.boolean().optional(),
  care_thread_id: z.string().uuid().optional(),
}).refine((v) => !v.is_case_discussion || Boolean(v.care_thread_id), {
  message: 'care_thread_id is required for a case discussion',
  path: ['care_thread_id'],
});

export const replySchema = z.object({
  body: z.string().min(1).max(8000),
});

export const requestSecondOpinionSchema = z.object({
  care_thread_id: z.string().uuid(),
  specialty: z.string().min(1).max(60),
  question: z.string().min(1).max(4000),
  attachment_keys: z.array(z.string()).optional(),
});

export const listSecondOpinionsQuery = z.object({
  status: z.enum(['open', 'claimed', 'answered', 'withdrawn']).optional(),
  specialty: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const answerSchema = z.object({
  answer: z.string().min(1).max(8000),
});
TS

# --- community + discussion service -----------------------------------------
cat > "$SVC/src/services/discussion.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';

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
TS

# --- second opinion service --------------------------------------------------
cat > "$SVC/src/services/secondOpinion.service.ts" << 'TS'
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
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/controllers/network.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as discussions from '../services/discussion.service.js';
import * as opinions from '../services/secondOpinion.service.js';
import {
  answerSchema, createDiscussionSchema, listDiscussionsQuery, listSecondOpinionsQuery,
  replySchema, requestSecondOpinionSchema,
} from '../types/network.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, cpid: req.auth!.cpid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const listCommunities = handle(() => discussions.listCommunities());

export const listDiscussions = handle((req) => discussions.listDiscussions(listDiscussionsQuery.parse(req.query)));

export const getDiscussion = handle((req) => discussions.getDiscussion(pathParam(req, 'discussion_id')));

export const createDiscussion = handle(
  (req, res) => discussions.createDiscussion(caller(req), createDiscussionSchema.parse(req.body), meta(req, res)), 201,
);

export const reply = handle((req, res) => {
  const input = replySchema.parse(req.body);
  return discussions.replyToDiscussion(pathParam(req, 'discussion_id'), caller(req), input.body, meta(req, res));
}, 201);

export const requestSecondOpinion = handle(
  (req, res) => opinions.requestSecondOpinion(caller(req), requestSecondOpinionSchema.parse(req.body), meta(req, res)), 201,
);

export const listSecondOpinions = handle((req) => opinions.listSecondOpinions(listSecondOpinionsQuery.parse(req.query)));

export const claimSecondOpinion = handle(
  (req, res) => opinions.claimSecondOpinion(pathParam(req, 'second_opinion_id'), caller(req), meta(req, res)),
);

export const answerSecondOpinion = handle((req, res) => {
  const input = answerSchema.parse(req.body);
  return opinions.answerSecondOpinion(pathParam(req, 'second_opinion_id'), caller(req), input.answer, meta(req, res));
});
TS

cat > "$SVC/src/routes/network.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/network.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const networkRouter = Router();

networkRouter.get('/network/communities', requireAuth, c.listCommunities);

networkRouter.get('/network/discussions', requireAuth, c.listDiscussions);
networkRouter.get('/network/discussions/:discussion_id', requireAuth, c.getDiscussion);
networkRouter.post('/network/discussions', requireAuth, idempotency, c.createDiscussion);
networkRouter.post('/network/discussions/:discussion_id/replies', requireAuth, idempotency, c.reply);

networkRouter.get('/network/second-opinions', requireAuth, c.listSecondOpinions);
networkRouter.post('/network/second-opinions', requireAuth, idempotency, c.requestSecondOpinion);
networkRouter.post('/network/second-opinions/:second_opinion_id/claim', requireAuth, idempotency, c.claimSecondOpinion);
networkRouter.post('/network/second-opinions/:second_opinion_id/answer', requireAuth, idempotency, c.answerSecondOpinion);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { networkRouter } from './routes/network.routes.js';

const service = createService({
  name: 'network',
  port: env.PORT,
  routers: [networkRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4017"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/network.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as discussions from '../services/discussion.service.js';
import * as opinions from '../services/secondOpinion.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const communityIds: string[] = [];
const threadIds: string[] = [];
const discussionIds: string[] = [];
const opinionIds: string[] = [];

after(async () => {
  for (const id of opinionIds) {
    await prisma.secondOpinion.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of discussionIds) {
    await prisma.discussionReply.deleteMany({ where: { discussionId: id } }).catch(() => undefined);
    await prisma.discussion.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of communityIds) {
    await prisma.community.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Network Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return { sub: user.id, role: 'clinician', cpid: profile.id };
}

async function makeCommunity() {
  const community = await prisma.community.create({ data: { name: `Test Community ${randomUUID().slice(0, 8)}`, specialty: 'general_practice' } });
  communityIds.push(community.id);
  return community;
}

async function makeThread() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Thread Patient' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Thread Patient' } });
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  return thread;
}

describe('discussions', () => {
  it('creates and reads a discussion with its replies', async () => {
    const clinician = await makeClinician();
    const community = await makeCommunity();

    const discussion = await discussions.createDiscussion(
      clinician, { community_id: community.id, title: 'Test', body: 'A question about dosing.' }, meta,
    );
    discussionIds.push(discussion.id);

    await discussions.replyToDiscussion(discussion.id, clinician, 'Try this approach.', meta);

    const fetched = await discussions.getDiscussion(discussion.id);
    assert.equal(fetched.reply_count, 1);
    assert.equal(fetched.replies.length, 1);
  });

  it('requires a care_thread_id for a case discussion', async () => {
    const clinician = await makeClinician();
    const community = await makeCommunity();

    await assert.rejects(
      () => discussions.createDiscussion(
        clinician, { community_id: community.id, title: 'Case', body: 'x', is_case_discussion: true }, meta,
      ),
    );
  });

  it('never exposes patient identity through a case discussion', async () => {
    const clinician = await makeClinician();
    const community = await makeCommunity();
    const thread = await makeThread();

    const discussion = await discussions.createDiscussion(
      clinician,
      { community_id: community.id, title: 'Case', body: 'De-identified question.', is_case_discussion: true, care_thread_id: thread.id },
      meta,
    );
    discussionIds.push(discussion.id);

    assert.ok(!('patient' in discussion));
    assert.ok(!('patient_name' in discussion));
  });

  it('refuses a non-clinician creating a discussion', async () => {
    const community = await makeCommunity();
    await assert.rejects(
      () => discussions.createDiscussion(
        { sub: randomUUID(), role: 'patient' }, { community_id: community.id, title: 'x', body: 'y' }, meta,
      ),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});

describe('second opinions', () => {
  it('requests, claims, and answers a second opinion', async () => {
    const requester = await makeClinician();
    const specialist = await makeClinician();
    const thread = await makeThread();

    const opinion = await opinions.requestSecondOpinion(
      requester, { care_thread_id: thread.id, specialty: 'dermatology', question: 'Is this concerning?' }, meta,
    );
    opinionIds.push(opinion.id);
    assert.equal(opinion.status, 'open');

    const claimed = await opinions.claimSecondOpinion(opinion.id, specialist, meta);
    assert.equal(claimed.status, 'claimed');
    assert.equal(claimed.answered_by_id, specialist.cpid);

    const answered = await opinions.answerSecondOpinion(opinion.id, specialist, 'Benign, monitor.', meta);
    assert.equal(answered.status, 'answered');
    assert.ok(answered.answered_at);
  });

  it('refuses a second claim on an already-claimed opinion', async () => {
    const requester = await makeClinician();
    const first = await makeClinician();
    const second = await makeClinician();
    const thread = await makeThread();

    const opinion = await opinions.requestSecondOpinion(
      requester, { care_thread_id: thread.id, specialty: 'cardiology', question: 'q' }, meta,
    );
    opinionIds.push(opinion.id);
    await opinions.claimSecondOpinion(opinion.id, first, meta);

    await assert.rejects(
      () => opinions.claimSecondOpinion(opinion.id, second, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses an answer from someone other than the claimant', async () => {
    const requester = await makeClinician();
    const claimant = await makeClinician();
    const stranger = await makeClinician();
    const thread = await makeThread();

    const opinion = await opinions.requestSecondOpinion(
      requester, { care_thread_id: thread.id, specialty: 'psychiatry', question: 'q' }, meta,
    );
    opinionIds.push(opinion.id);
    await opinions.claimSecondOpinion(opinion.id, claimant, meta);

    await assert.rejects(
      () => opinions.answerSecondOpinion(opinion.id, stranger, 'answer', meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('refuses answering an opinion that is still open', async () => {
    const requester = await makeClinician();
    const thread = await makeThread();
    const opinion = await opinions.requestSecondOpinion(
      requester, { care_thread_id: thread.id, specialty: 'oncology', question: 'q' }, meta,
    );
    opinionIds.push(opinion.id);

    await assert.rejects(
      () => opinions.answerSecondOpinion(opinion.id, requester, 'answer', meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/api lint"
echo "  pnpm --filter @a-health/network exec tsc --noEmit"
echo "  pnpm --filter @a-health/network test"
