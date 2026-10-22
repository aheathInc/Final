import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { clinicianRouter } from './routes/clinician.routes.js';

const service = createService({
  name: 'doctor',
  port: env.PORT,
  routers: [clinicianRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
