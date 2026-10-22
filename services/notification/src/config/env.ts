import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4008),
  DATABASE_URL: z.string(),

  /** `console` prints instead of sending. Anything else needs a gateway URL. */
  SMS_PROVIDER: z.enum(['console', 'http']).default('console'),
  SMS_GATEWAY_URL: z.string().default(''),
  SMS_GATEWAY_KEY: z.string().default(''),
  SMS_SENDER_ID: z.string().default('A-HEALTH'),

  DISPATCH_INTERVAL_SECONDS: z.coerce.number().default(10),
  DISPATCH_BATCH_SIZE: z.coerce.number().default(50),

  /**
   * How long an in-app message is given to be read before it is also sent by
   * SMS. Long enough that someone with the app open is not charged for a
   * duplicate; short enough that someone who never opens it is not left
   * waiting.
   */
  MESSAGE_SMS_GRACE_SECONDS: z.coerce.number().default(180),

  MAX_ATTEMPTS: z.coerce.number().default(4),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
  throw new Error('SMS_PROVIDER=console cannot be used in production — nothing would be sent.');
}
