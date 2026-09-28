import { createPostgresEventBus, createService } from '@a-health/http';
import { env } from './config/env.js';
import { buildRouter } from './routes/message.routes.js';
import { attachRealtime } from './realtime/server.js';
import { sweepTickets } from './services/realtime.service.js';

const bus = createPostgresEventBus(env.DATABASE_URL);

const service = createService({
  name: 'messaging',
  port: env.PORT,
  routers: [buildRouter(bus)],
  development: env.NODE_ENV === 'development',
  onShutdown: () => bus.close(),
});

const server = service.start();
attachRealtime(server, bus);

const sweep = setInterval(() => {
  void sweepTickets().catch(() => undefined);
}, 3600_000);
sweep.unref();
