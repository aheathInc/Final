import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { aiRouter } from './routes/ai.routes.js';
import { seedModelRegistry } from './services/registry.js';

const service = createService({
  name: 'ai',
  port: env.PORT,
  routers: [aiRouter],
  development: env.NODE_ENV === 'development',
});

// Idempotent; safe on every boot. Keeps the registry complete without a
// separate migration step every time the shortlist changes.
await seedModelRegistry();

service.start();
