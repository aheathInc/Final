import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { patientRouter } from './routes/patient.routes.js';

const service = createService({
  name: 'patient',
  port: env.PORT,
  routers: [patientRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
