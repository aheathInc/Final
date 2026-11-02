import { z } from "zod";

export const listDiscussionsQuery = z.object({
  community_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const createDiscussionSchema = z
  .object({
    community_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(8000),
    is_case_discussion: z.boolean().optional(),
    care_thread_id: z.string().uuid().optional(),
  })
  .refine((v) => !v.is_case_discussion || Boolean(v.care_thread_id), {
    message: "care_thread_id is required for a case discussion",
    path: ["care_thread_id"],
  });

export const replySchema = z.object({
  body: z.string().trim().min(1).max(8000),
  parent_reply_id: z.string().uuid().optional(),
});

export const membershipSchema = z
  .object({
    notification_mode: z.enum(["all", "replies", "muted"]).default("replies"),
  })
  .strict();

export const requestSecondOpinionSchema = z.object({
  care_thread_id: z.string().uuid(),
  specialty: z.string().min(1).max(60),
  question: z.string().min(1).max(4000),
  attachment_keys: z.array(z.string()).optional(),
});

export const listSecondOpinionsQuery = z.object({
  status: z.enum(["open", "claimed", "answered", "withdrawn"]).optional(),
  specialty: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const answerSchema = z.object({
  answer: z.string().min(1).max(8000),
});
