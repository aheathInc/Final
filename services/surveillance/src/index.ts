import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { surveillanceRouter } from './routes/surveillance.routes.js';
import { startRollupWorker } from './workers/rollup.worker.js';

const service = createService({
  name: 'surveillance',
  port: env.PORT,
  routers: [surveillanceRouter],
  development: env.NODE_ENV === 'development',
});

startRollupWorker();
service.start();
