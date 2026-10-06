import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { authRouter, userRouter } from './routes/auth.routes.js';
import { ledgerRouter } from './routes/ledger.routes.js';
import { scheduleSweep } from './services/maintenance.service.js';

// Helmet, CORS, JSON parsing, request ids, access logging, /health, the error
// envelope and graceful shutdown all come from the shared bootstrap. What is
// left here is what is actually specific to auth.
const service = createService({
  name: 'auth',
  port: env.PORT,
  host: '0.0.0.0',
  routers: [authRouter, userRouter, ledgerRouter],
  development: env.NODE_ENV === 'development',
});

scheduleSweep();
service.start();
