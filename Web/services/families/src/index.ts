import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { familiesRouter } from './routes/families.routes.js';

const service = createService({
  name: 'families',
  port: env.PORT,
  routers: [familiesRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
