import { z } from 'zod';
export const createIntentSchema=z.object({bill_id:z.string().uuid(),method:z.literal('mobile_money'),provider:z.enum(['mpesa','tigo_pesa','airtel_money']),payer_phone:z.string().regex(/^\+255\d{9}$/),payer_email:z.string().email().max(150).optional()}).strict();
export const issueBillSchema=z.object({consultation_id:z.string().uuid(),amount:z.number().int().min(1).max(2147483647),currency:z.literal('TZS').default('TZS'),title:z.string().trim().min(3).max(120)}).strict();
export const listPaymentsQuery=z.object({consultation_id:z.string().uuid().optional(),status:z.enum(['pending','requires_action','processing','succeeded','failed','cancelled','refunded','partially_refunded']).optional(),cursor:z.string().optional(),limit:z.coerce.number().int().min(1).max(100).default(25)});
export const refundSchema=z.object({amount:z.number().min(0.01).optional(),reason:z.string().min(1).max(500)});
export const webhookProviderParam=z.enum(['mpesa','tigo_pesa','airtel_money']);
