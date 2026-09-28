import { z } from 'zod';

export const ussdSessionSchema = z.object({
  session_id: z.string().min(1),
  phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/),
  service_code: z.string().optional(),
  text: z.string().default(''),
});

export const smsInboundSchema = z.object({
  from: z.string().regex(/^\+[1-9]\d{7,14}$/),
  to: z.string().optional(),
  text: z.string(),
  received_at: z.string().datetime(),
  aggregator_message_id: z.string().optional(),
});
