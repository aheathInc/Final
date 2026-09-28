import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { emergencyRouter } from './routes/emergency.routes.js';
import { bus } from './events.js';

const service = createService({
  name: 'emergency',
  port: env.PORT,
  routers: [emergencyRouter],
  development: env.NODE_ENV === 'development',
  onShutdown: () => bus.close(),
});

service.start();
