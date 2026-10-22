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
