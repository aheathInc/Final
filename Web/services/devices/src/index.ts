import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { devicesRouter } from './routes/devices.routes.js';

const service = createService({
  name: 'devices',
  port: env.PORT,
  routers: [devicesRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
