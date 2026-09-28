import { z } from 'zod';

export const createOrderSchema = z.object({
  care_thread_id: z.string().uuid(),
  consultation_id: z.string().uuid().optional(),
  investigation_code: z.string().min(1).max(60),
  investigation_type: z.enum(['laboratory', 'imaging', 'pathology', 'point_of_care']),
  clinical_notes: z.string().max(2000).optional(),
  urgency: z.enum(['routine', 'urgent', 'emergency']).optional(),
  facility_id: z.string().uuid().optional(),
});

export const resultValueSchema = z.object({
  analyte: z.string().min(1).max(120),
  value: z.string().min(1).max(200),
  unit: z.string().max(40).optional(),
  reference_low: z.number().optional(),
  reference_high: z.number().optional(),
  /** Consumed only to compute the flag server-side; not persisted as-is. */
  critical_low: z.number().optional(),
  critical_high: z.number().optional(),
});

export const fileResultSchema = z.object({
  values: z.array(resultValueSchema).min(1),
  narrative: z.string().max(4000).optional(),
  attachment_key: z.string().max(500).optional(),
});

export const listOrdersQuery = z.object({
  care_thread_id: z.string().uuid().optional(),
  status: z.enum(['ordered', 'scheduled', 'collected', 'resulted', 'acknowledged', 'cancelled']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type FileResultInput = z.infer<typeof fileResultSchema>;
