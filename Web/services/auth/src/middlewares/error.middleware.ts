import { createErrorHandler, notFoundHandler } from '@a-health/http';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

export { notFoundHandler };
export const errorHandler = createErrorHandler(
  createLogger('auth'),
  env.NODE_ENV === 'development',
);
