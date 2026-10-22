import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { networkRouter } from './routes/network.routes.js';
import { interopRouter } from './routes/interop.routes.js';

const service = createService({
  name: 'network',
  port: env.PORT,
  routers: [networkRouter, interopRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
