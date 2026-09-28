import { z } from 'zod';

export const getChangesQuery = z.object({
  cursor: z.string().optional(),
  entities: z.union([z.string(), z.array(z.string())]).optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const syncOperationSchema = z.object({
  op_id: z.string().uuid(),
  method: z.enum(['POST', 'PATCH']),
  path: z.string(),
  path_params: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  client_created_at: z.string().datetime().optional(),
});

export const postBatchSchema = z.object({
  operations: z.array(syncOperationSchema).min(1).max(100),
});
