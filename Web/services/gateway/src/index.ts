import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { gatewayRouter } from './routes/gateway.routes.js';
import { captureRawBody } from './middleware/rawBody.js';

const service = createService({
  name: 'gateway',
  port: env.PORT,
  routers: [gatewayRouter],
  development: env.NODE_ENV === 'development',
  // The gateway is the one service whose caller (the telecom aggregator) has
  // no bearer token — it is authenticated by an HMAC over the raw request
  // body instead, which needs the exact bytes Express received before JSON
  // parsing re-serialises them differently than the sender did.
  jsonVerify: captureRawBody,
});

service.start();
