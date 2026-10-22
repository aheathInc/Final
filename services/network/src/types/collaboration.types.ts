import { z } from 'zod';

export const listCollaborationsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const consultationIdQuery = z.object({ consultation_id: z.string().uuid() });

export const listMessagesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const requestCollaborationSchema = z.object({
  consultation_id: z.string().uuid(),
  invited_clinician_id: z.string().uuid(),
  question: z.string().trim().min(1).max(4000),
  expires_at: z.string().datetime().optional(),
});

export const collaborationMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
});

export type RequestCollaborationInput = z.infer<typeof requestCollaborationSchema>;
