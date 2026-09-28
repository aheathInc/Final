#!/usr/bin/env bash
#
# Builds services/education — multilingual health education content
# (blueprint §10, "combat misinformation at scale").
#
# The contract as restored only described reading content (list topics, list
# articles, get one) — nothing to actually get content INTO the system. Same
# gap as doctor's missing admin queue earlier: read endpoints with nothing to
# serve aren't useful. Adds three small authoring endpoints (create topic,
# create article, publish) alongside the three read ones, and patches the
# contract to match, the same way doctor's GET /clinicians was added.
#
# Run from the repo root:
#   bash setup-education-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/education"
API="$ROOT/packages/api/openapi/a-health-api-v1.yaml"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

# ---------------------------------------------------------------------------
# Step 0: confirm every error code this service needs already exists.
# ---------------------------------------------------------------------------
ERRORS="$ROOT/packages/http/src/errors.ts"
for code in DUPLICATE_RESOURCE NOT_FOUND FORBIDDEN ROLE_NOT_PERMITTED STATE_TRANSITION_INVALID; do
  if ! grep -q "'$code'" "$ERRORS"; then
    echo "  MISSING ERROR CODE: $code — stopping before writing anything that would fail tsc"
    exit 1
  fi
done
echo "  confirmed: all required error codes already exist in packages/http"

# ---------------------------------------------------------------------------
# Contract patch: add the three authoring endpoints the restore missed.
# ---------------------------------------------------------------------------
if [ -f "$API" ]; then
  cp "$API" "$API.bak"
  python3 - "$API" << 'PYEOF'
import sys
path = sys.argv[1]
doc = open(path).read()

if 'createEducationTopic' in doc:
    print('  contract already has education authoring endpoints')
else:
    anchor = '  /education/topics:\n    get:'
    if anchor not in doc:
        print('  /education/topics anchor not found; skipping contract patch (non-fatal)')
    else:
        POST_TOPIC = '''  /education/topics:
    post:
      tags: [education]
      summary: Create a topic
      description: Admin only. The category an article is filed under.
      operationId: createEducationTopic
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [slug, name, category]
              properties:
                slug: { type: string, maxLength: 80 }
                name: { type: string, maxLength: 150 }
                category:
                  type: string
                  enum: [communicable, non_communicable, maternal_child, mental_health, prevention, nutrition]
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/EducationTopic' }
        '403': { $ref: '#/components/responses/Forbidden' }
    get:'''
        doc = doc.replace(anchor, POST_TOPIC, 1)

        anchor2 = '  /education/articles:\n    get:'
        POST_ARTICLE = '''  /education/articles:
    post:
      tags: [education]
      summary: Author a draft article
      description: |
        Clinician or admin. Created unpublished — a clinical reviewer must
        publish it (a separate action) before it reaches patients, so nothing
        goes out to a low-literacy, low-bandwidth audience unreviewed.
      operationId: createEducationArticle
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [topic_slug, slug, title, summary, language]
              properties:
                topic_slug: { type: string }
                slug: { type: string, maxLength: 120 }
                title: { type: string, maxLength: 200 }
                summary: { type: string }
                body: { type: string }
                language: { $ref: '#/components/schemas/LanguageCode' }
                format: { $ref: '#/components/schemas/ContentFormat' }
                reading_level:
                  type: string
                  enum: [basic, intermediate, advanced]
                media_key: { type: string }
      responses:
        '201':
          description: Draft created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/EducationArticle' }
        '403': { $ref: '#/components/responses/Forbidden' }
    get:'''
        doc = doc.replace(anchor2, POST_ARTICLE, 1)

        anchor3 = "  /education/articles/{slug}:\n    get:"
        PUBLISH = '''  /education/articles/{slug}/publish:
    post:
      tags: [education]
      summary: Review and publish a draft article
      description: Clinician or admin. Sets the reviewer and makes the article visible to GET /education/articles.
      operationId: publishEducationArticle
      parameters:
        - name: slug
          in: path
          required: true
          schema: { type: string }
        - name: language
          in: query
          required: true
          schema: { $ref: '#/components/schemas/LanguageCode' }
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '200':
          description: Published
          content:
            application/json:
              schema: { $ref: '#/components/schemas/EducationArticle' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }

  /education/articles/{slug}:
    get:'''
        doc = doc.replace(anchor3, PUBLISH, 1)

        open(path, 'w').write(doc)
        print('  contract: 3 authoring endpoints added (createEducationTopic, createEducationArticle, publishEducationArticle)')
PYEOF

  python3 - "$API" << 'PY'
import sys, re, yaml
p = sys.argv[1]
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
print(f"  contract check: paths {len(d['paths'])} | refs broken: {bad or 'none'} | duplicate ops: {dupes or 'none'}")
if bad or dupes: sys.exit(1)
PY
fi

mkdir -p "$SVC/src"/{config,routes,controllers,services,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/education';
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
  PORT: z.coerce.number().default(4016),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/types/education.types.ts" << 'TS'
import { z } from 'zod';

const languageCode = z.enum(['sw', 'en', 'fr', 'ha', 'am']);
const contentFormat = z.enum(['article', 'audio', 'video', 'interactive', 'sms_series']);
const readingLevel = z.enum(['basic', 'intermediate', 'advanced']);
const category = z.enum(['communicable', 'non_communicable', 'maternal_child', 'mental_health', 'prevention', 'nutrition']);

export const createTopicSchema = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(150),
  category,
});

export const listTopicsQuery = z.object({
  language: languageCode.optional(),
});

export const createArticleSchema = z.object({
  topic_slug: z.string().min(1),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(200),
  summary: z.string().min(1),
  body: z.string().optional(),
  language: languageCode,
  format: contentFormat.optional(),
  reading_level: readingLevel.optional(),
  media_key: z.string().optional(),
});

export const listArticlesQuery = z.object({
  topic_slug: z.string().optional(),
  language: languageCode.optional(),
  format: contentFormat.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const getArticleQuery = z.object({
  language: languageCode.optional(),
});

export const publishArticleQuery = z.object({
  language: languageCode,
});
TS

# --- service --------------------------------------------------------------
cat > "$SVC/src/services/education.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';

export interface Caller { sub: string; role: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function assertAuthor(caller: Caller) {
  if (caller.role !== 'clinician' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a clinician or admin may manage education content');
  }
}

function serialiseTopic(t: { slug: string; name: string; category: string; isActive: boolean }, articleCount = 0) {
  return { slug: t.slug, name: t.name, category: t.category, article_count: articleCount };
}

function serialiseArticle(a: {
  slug: string; title: string; summary: string; body: string | null; mediaKey: string | null;
  language: string; format: string; readingLevel: string; mythVsFact: unknown;
  reviewedById: string | null; reviewedAt: Date | null; publishedAt: Date | null;
  topic?: { slug: string };
}) {
  return {
    slug: a.slug,
    topic_slug: a.topic?.slug,
    title: a.title,
    summary: a.summary,
    body: a.body,
    media_key: a.mediaKey,
    language: a.language,
    format: a.format,
    reading_level: a.readingLevel,
    myth_vs_fact: a.mythVsFact ?? [],
    reviewed_by_id: a.reviewedById,
    reviewed_at: a.reviewedAt?.toISOString() ?? null,
  };
}

/** Admin only. The category an article is filed under. */
export async function createTopic(caller: Caller, input: { slug: string; name: string; category: string }, meta: Meta) {
  if (caller.role !== 'platform_admin') throw forbidden('ROLE_NOT_PERMITTED', 'Only an admin may create topics');

  const existing = await prisma.educationTopic.findUnique({ where: { slug: input.slug } });
  if (existing) throw conflict('DUPLICATE_RESOURCE', 'A topic with this slug already exists');

  const topic = await prisma.educationTopic.create({
    data: { slug: input.slug, name: input.name, category: input.category as never },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'education.topic_created',
    entityType: 'education_topics', entityId: topic.id,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseTopic(topic);
}

export async function listTopics(query: { language?: string }) {
  const topics = await prisma.educationTopic.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  const counts = await prisma.educationArticle.groupBy({
    by: ['topicId'],
    where: { publishedAt: { not: null }, ...(query.language ? { language: query.language as never } : {}) },
    _count: { _all: true },
  });
  const countByTopic = new Map(counts.map((c) => [c.topicId, c._count._all]));
  return { data: topics.map((t) => serialiseTopic(t, countByTopic.get(t.id) ?? 0)) };
}

/**
 * Authors a draft. Created unpublished — nothing reaches a patient until a
 * clinical reviewer has looked at it, which is a separate action
 * (publishArticle). A low-literacy, low-bandwidth audience gets exactly one
 * chance to trust this content; publishing it unreviewed would spend that
 * trust before the platform has earned it.
 */
export async function createArticle(
  caller: Caller,
  input: {
    topic_slug: string; slug: string; title: string; summary: string; body?: string;
    language: string; format?: string; reading_level?: string; media_key?: string;
  },
  meta: Meta,
) {
  assertAuthor(caller);

  const topic = await prisma.educationTopic.findUnique({ where: { slug: input.topic_slug } });
  if (!topic) throw notFound('Topic not found');

  const existing = await prisma.educationArticle.findUnique({
    where: { slug_language: { slug: input.slug, language: input.language as never } },
  });
  if (existing) throw conflict('DUPLICATE_RESOURCE', 'An article with this slug already exists in this language');

  const article = await prisma.educationArticle.create({
    data: {
      topicId: topic.id,
      slug: input.slug,
      title: input.title,
      summary: input.summary,
      body: input.body ?? null,
      mediaKey: input.media_key ?? null,
      language: input.language as never,
      format: (input.format ?? 'article') as never,
      readingLevel: (input.reading_level ?? 'basic') as never,
    },
    include: { topic: true },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'education.article_drafted',
    entityType: 'education_articles', entityId: article.id,
    metadata: { slug: input.slug, language: input.language },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseArticle(article);
}

/**
 * Publishes a reviewed draft. The reviewer is stamped from the caller — a
 * clinician cannot publish their own draft as someone else's review, and
 * this is what a "who approved this claim" question is answered from later.
 */
export async function publishArticle(slug: string, language: string, caller: Caller, meta: Meta) {
  assertAuthor(caller);

  const article = await prisma.educationArticle.findUnique({
    where: { slug_language: { slug, language: language as never } },
  });
  if (!article) throw notFound('Article not found');
  if (article.publishedAt) throw conflict('STATE_TRANSITION_INVALID', 'This article is already published');

  const updated = await prisma.educationArticle.update({
    where: { slug_language: { slug, language: language as never } },
    data: { reviewedById: caller.sub, reviewedAt: new Date(), publishedAt: new Date(), version: { increment: 1 } },
    include: { topic: true },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'education.article_published',
    entityType: 'education_articles', entityId: updated.id,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseArticle(updated);
}

/** Public. Only published content — a draft is never visible outside authoring. */
export async function listArticles(
  query: { topic_slug?: string; language?: string; format?: string; cursor?: string; limit: number },
) {
  const rows = await prisma.educationArticle.findMany({
    where: {
      publishedAt: { not: null },
      ...(query.topic_slug ? { topic: { slug: query.topic_slug } } : {}),
      ...(query.language ? { language: query.language as never } : {}),
      ...(query.format ? { format: query.format as never } : {}),
    },
    include: { topic: true },
    orderBy: { publishedAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseArticle);
}

/**
 * Falls back from the requested language to Swahili, then English, then any
 * published language — a missing translation must never mean a missing
 * article, matching the same rule the notification templates follow.
 */
export async function getArticle(slug: string, requestedLanguage: string | undefined) {
  const candidates = await prisma.educationArticle.findMany({
    where: { slug, publishedAt: { not: null } },
    include: { topic: true },
  });
  if (candidates.length === 0) throw notFound('Article not found');

  const order = [requestedLanguage, 'sw', 'en'].filter((l): l is string => Boolean(l));
  for (const lang of order) {
    const match = candidates.find((c) => c.language === lang);
    if (match) return serialiseArticle(match);
  }
  return serialiseArticle(candidates[0]!);
}
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/controllers/education.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as education from '../services/education.service.js';
import {
  createArticleSchema, createTopicSchema, getArticleQuery, listArticlesQuery, listTopicsQuery, publishArticleQuery,
} from '../types/education.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, cpid: req.auth!.cpid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const createTopic = handle(
  (req, res) => education.createTopic(caller(req), createTopicSchema.parse(req.body), meta(req, res)), 201,
);

export const listTopics = handle((req) => education.listTopics(listTopicsQuery.parse(req.query)));

export const createArticle = handle(
  (req, res) => education.createArticle(caller(req), createArticleSchema.parse(req.body), meta(req, res)), 201,
);

export const listArticles = handle((req) => education.listArticles(listArticlesQuery.parse(req.query)));

export const getArticle = handle((req) => {
  const query = getArticleQuery.parse(req.query);
  return education.getArticle(pathParam(req, 'slug'), query.language);
});

export const publishArticle = handle((req, res) => {
  const query = publishArticleQuery.parse(req.query);
  return education.publishArticle(pathParam(req, 'slug'), query.language, caller(req), meta(req, res));
});
TS

cat > "$SVC/src/routes/education.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/education.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const educationRouter = Router();

// Reading is public — health information must not be gated behind a login.
educationRouter.get('/education/topics', c.listTopics);
educationRouter.get('/education/articles', c.listArticles);
educationRouter.get('/education/articles/:slug', c.getArticle);

// Authoring requires a session and a clinician/admin role, enforced in the service layer.
educationRouter.post('/education/topics', requireAuth, idempotency, c.createTopic);
educationRouter.post('/education/articles', requireAuth, idempotency, c.createArticle);
educationRouter.post('/education/articles/:slug/publish', requireAuth, idempotency, c.publishArticle);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { educationRouter } from './routes/education.routes.js';

const service = createService({
  name: 'education',
  port: env.PORT,
  routers: [educationRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4016"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/education.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as education from '../services/education.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const admin = { sub: randomUUID(), role: 'platform_admin' };
const clinician = { sub: randomUUID(), role: 'clinician' };
const topicSlugs: string[] = [];
const articleKeys: { slug: string; language: string }[] = [];

after(async () => {
  for (const { slug, language } of articleKeys) {
    await prisma.educationArticle.deleteMany({ where: { slug, language: language as never } }).catch(() => undefined);
  }
  for (const slug of topicSlugs) {
    await prisma.educationTopic.delete({ where: { slug } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function makeTopic() {
  const slug = uniqueSlug('topic');
  const topic = await education.createTopic(admin, { slug, name: 'Test Topic', category: 'prevention' }, meta);
  topicSlugs.push(slug);
  return topic;
}

describe('topics', () => {
  it('creates a topic as admin', async () => {
    const topic = await makeTopic();
    assert.equal(topic.category, 'prevention');
  });

  it('refuses a non-admin creating a topic', async () => {
    await assert.rejects(
      () => education.createTopic(clinician, { slug: uniqueSlug('t'), name: 'x', category: 'nutrition' }, meta),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('refuses a duplicate slug', async () => {
    const topic = await makeTopic();
    await assert.rejects(
      () => education.createTopic(admin, { slug: topic.slug, name: 'dup', category: 'nutrition' }, meta),
      (e: AppError) => e.code === 'DUPLICATE_RESOURCE',
    );
  });
});

describe('articles', () => {
  it('drafts are not visible until published', async () => {
    const topic = await makeTopic();
    const slug = uniqueSlug('article');
    await education.createArticle(
      clinician, { topic_slug: topic.slug, slug, title: 'Draft', summary: 's', language: 'sw' }, meta,
    );
    articleKeys.push({ slug, language: 'sw' });

    await assert.rejects(
      () => education.getArticle(slug, 'sw'),
      (e: AppError) => e.code === 'NOT_FOUND',
    );
  });

  it('becomes visible after publishing, with the reviewer stamped', async () => {
    const topic = await makeTopic();
    const slug = uniqueSlug('article');
    await education.createArticle(
      clinician, { topic_slug: topic.slug, slug, title: 'Published', summary: 's', language: 'sw' }, meta,
    );
    articleKeys.push({ slug, language: 'sw' });

    const published = await education.publishArticle(slug, 'sw', clinician, meta);
    assert.equal(published.reviewed_by_id, clinician.sub);

    const fetched = await education.getArticle(slug, 'sw');
    assert.equal(fetched.slug, slug);
  });

  it('refuses publishing the same article twice', async () => {
    const topic = await makeTopic();
    const slug = uniqueSlug('article');
    await education.createArticle(
      clinician, { topic_slug: topic.slug, slug, title: 'X', summary: 's', language: 'sw' }, meta,
    );
    articleKeys.push({ slug, language: 'sw' });
    await education.publishArticle(slug, 'sw', clinician, meta);

    await assert.rejects(
      () => education.publishArticle(slug, 'sw', clinician, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('falls back to Swahili when the requested language is missing', async () => {
    const topic = await makeTopic();
    const slug = uniqueSlug('article');
    await education.createArticle(
      clinician, { topic_slug: topic.slug, slug, title: 'Kiswahili', summary: 's', language: 'sw' }, meta,
    );
    articleKeys.push({ slug, language: 'sw' });
    await education.publishArticle(slug, 'sw', clinician, meta);

    const fetched = await education.getArticle(slug, 'fr');
    assert.equal(fetched.language, 'sw');
  });

  it('lists only published articles for a topic', async () => {
    const topic = await makeTopic();
    const publishedSlug = uniqueSlug('pub');
    const draftSlug = uniqueSlug('draft');
    await education.createArticle(clinician, { topic_slug: topic.slug, slug: publishedSlug, title: 'P', summary: 's', language: 'sw' }, meta);
    articleKeys.push({ slug: publishedSlug, language: 'sw' });
    await education.publishArticle(publishedSlug, 'sw', clinician, meta);
    await education.createArticle(clinician, { topic_slug: topic.slug, slug: draftSlug, title: 'D', summary: 's', language: 'sw' }, meta);
    articleKeys.push({ slug: draftSlug, language: 'sw' });

    const result = await education.listArticles({ topic_slug: topic.slug, limit: 25 });
    const slugs = result.data.map((a) => a.slug);
    assert.ok(slugs.includes(publishedSlug));
    assert.ok(!slugs.includes(draftSlug));
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/api lint"
echo "  pnpm --filter @a-health/education exec tsc --noEmit"
echo "  pnpm --filter @a-health/education test"
