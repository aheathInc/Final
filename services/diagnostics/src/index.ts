import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { diagnosticsRouter } from './routes/diagnostics.routes.js';

const service = createService({
  name: 'diagnostics',
  port: env.PORT,
  routers: [diagnosticsRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
