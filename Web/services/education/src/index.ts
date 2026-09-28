import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { educationRouter } from './routes/education.routes.js';

const service = createService({
  name: 'education',
  port: env.PORT,
  routers: [educationRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
