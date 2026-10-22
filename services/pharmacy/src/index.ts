import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { pharmacyRouter } from './routes/pharmacy.routes.js';

const service = createService({
  name: 'pharmacy',
  port: env.PORT,
  routers: [pharmacyRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
