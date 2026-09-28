import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { appointmentRouter } from './routes/appointment.routes.js';

const service = createService({
  name: 'appointment',
  port: env.PORT,
  routers: [appointmentRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
