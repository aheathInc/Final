import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { facilitiesRouter } from './routes/facilities.routes.js';

const service = createService({
  name: 'facilities',
  port: env.PORT,
  routers: [facilitiesRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
