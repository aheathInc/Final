import { createIdempotency } from '@a-health/http';
import { env } from '../config/env.js';

export const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);
