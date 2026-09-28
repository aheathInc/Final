import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { insuranceRouter } from './routes/insurance.routes.js';

const service = createService({
  name: 'insurance',
  port: env.PORT,
  routers: [insuranceRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
