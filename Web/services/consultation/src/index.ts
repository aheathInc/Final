import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { consultationRouter } from './routes/consultation.routes.js';
import { startSlaWorker } from './workers/sla.worker.js';
import { bus } from './events.js';
import { seedDefaultRuleset } from './services/ruleset.service.js';

const service = createService({
  name: 'consultation',
  port: env.PORT,
  routers: [consultationRouter],
  development: env.NODE_ENV === 'development',
  onShutdown: () => bus.close(),
});

startSlaWorker();
await seedDefaultRuleset();
service.start();
