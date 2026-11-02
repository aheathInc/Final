import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { networkRouter } from './routes/network.routes.js';
import { interopRouter } from './routes/interop.routes.js';
import { patientPlatformRouter } from './routes/patientPlatform.routes.js';

const service = createService({
  name: 'network',
  port: env.PORT,
  routers: [networkRouter, interopRouter, patientPlatformRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
