import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { researchRouter } from './routes/research.routes.js';
import { seedDatasets } from './services/seedDatasets.js';

const service = createService({
  name: 'research',
  port: env.PORT,
  routers: [researchRouter],
  development: env.NODE_ENV === 'development',
});

await seedDatasets();
service.start();
