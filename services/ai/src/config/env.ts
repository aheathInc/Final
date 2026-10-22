import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4009),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /**
   * `stub` runs deterministic offline logic — no network call, no GPU,
   * pattern-matching red flags well enough to develop and test against.
   * `openai_compatible` targets any self-hosted or vendor endpoint that speaks
   * the chat-completions shape (this is how Llama 3.1 and MedGemma are
   * intended to be served — vLLM, TGI, or similar, not called directly).
   */
  CHAT_PROVIDER: z.enum(['stub', 'openai_compatible']).default('stub'),
  CHAT_MODEL_ENDPOINT: z.string().default(''),
  CHAT_MODEL_KEY: z.string().default(''),
  CHAT_MODEL_NAME: z.string().default('llama-3.1'),

  TRANSCRIBE_PROVIDER: z.enum(['stub', 'whisper_http']).default('stub'),
  TRANSCRIBE_ENDPOINT: z.string().default(''),

  MAX_MESSAGE_LENGTH: z.coerce.number().default(4000),
  RATE_LIMIT_MESSAGES_PER_HOUR: z.coerce.number().default(60),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production' && env.CHAT_PROVIDER === 'stub') {
  throw new Error('CHAT_PROVIDER=stub cannot be used in production — nothing would actually run.');
}
