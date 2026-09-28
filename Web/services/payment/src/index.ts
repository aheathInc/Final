import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { paymentRouter } from './routes/payment.routes.js';

const service = createService({
  name: 'payment',
  port: env.PORT,
  routers: [paymentRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
