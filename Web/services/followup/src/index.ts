import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { followupRouter } from './routes/followup.routes.js';
import { startScheduler } from './workers/scheduler.worker.js';

const service = createService({
  name: 'followup',
  port: env.PORT,
  routers: [followupRouter],
  development: env.NODE_ENV === 'development',
});

startScheduler();
service.start();
