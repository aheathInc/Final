import { z } from 'zod';

export const createIntentSchema = z.object({
  amount: z.number().min(1),
  currency: z.string().length(3).default('TZS'),
  method: z.enum(['mobile_money', 'card', 'cash', 'insurance']),
  purpose: z.enum(['consultation_fee', 'pharmacy_purchase', 'insurance_copay', 'subscription', 'other']),
  consultation_id: z.string().uuid().optional(),
  dispensing_id: z.string().uuid().optional(),
  insurance_claim_id: z.string().uuid().optional(),
  payer_phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  return_url: z.string().url().optional(),
});

export const listPaymentsQuery = z.object({
  consultation_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const refundSchema = z.object({
  amount: z.number().min(0.01).optional(),
  reason: z.string().min(1).max(500),
});

export const webhookProviderParam = z.enum(['mpesa', 'tigo_pesa', 'airtel_money', 'card_gateway', 'manual']);
