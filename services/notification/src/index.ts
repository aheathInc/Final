import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { startDispatchWorker } from './workers/dispatch.worker.js';

// No routes of its own yet. Producers enqueue by writing a NotificationLog row;
// this process exists to drain it. The HTTP surface is here for /health, which
// is what tells you the queue is being worked at all.
const service = createService({
  name: 'notification',
  port: env.PORT,
  routers: [],
  development: env.NODE_ENV === 'development',
});

startDispatchWorker();
service.start();
