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
