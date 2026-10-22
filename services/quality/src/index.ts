import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { qualityRouter } from './routes/quality.routes.js';

const service = createService({
  name: 'quality',
  port: env.PORT,
  routers: [qualityRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
