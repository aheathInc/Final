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
  disease_guide: z.object({
    causes:z.string().trim().min(1).max(6000),
    symptoms:z.string().trim().min(1).max(6000),
    prevention:z.string().trim().min(1).max(6000),
    diagnosis:z.string().trim().min(1).max(6000),
    treatment:z.string().trim().min(1).max(6000),
    warning_signs:z.string().trim().min(1).max(6000),
  }).optional(),
  sources:z.array(z.object({title:z.string().min(1).max(200),url:z.url().refine(v=>v.startsWith('https://'),'HTTPS source required')})).max(20).optional(),
});

export const listArticlesQuery = z.object({
  q:z.string().trim().max(100).optional(),
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
