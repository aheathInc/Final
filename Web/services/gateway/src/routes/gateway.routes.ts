import { Router } from 'express';
import { createGatewaySignatureGuard } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/gateway.controller.js';

const guard = createGatewaySignatureGuard(env.GATEWAY_SHARED_SECRET);

export const gatewayRouter = Router();

gatewayRouter.post('/gateway/ussd/session', guard, c.ussdSession);
gatewayRouter.post('/gateway/sms/inbound', guard, c.smsInbound);
