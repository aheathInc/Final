import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { preventionRouter } from './routes/prevention.routes.js';
import { seedProgrammes } from './services/seedProgrammes.js';

const service = createService({
  name: 'prevention',
  port: env.PORT,
  routers: [preventionRouter],
  development: env.NODE_ENV === 'development',
});

await seedProgrammes();
service.start();
