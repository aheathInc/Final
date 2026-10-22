import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { syncRouter } from './routes/sync.routes.js';

const service = createService({
  name: 'sync',
  port: env.PORT,
  routers: [syncRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
