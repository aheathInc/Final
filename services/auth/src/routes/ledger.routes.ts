import { Router } from 'express';
import { createAuthGuards } from '@a-health/http';
import { tokenService } from '../utils/jwt.js';
import * as controller from '../controllers/ledger.controller.js';

const { requireAuth, requireRole } = createAuthGuards(tokenService);
export const ledgerRouter = Router();

ledgerRouter.get('/audit/ledger', requireAuth, requireRole('platform_admin'), controller.list);
ledgerRouter.post('/audit/verify', requireAuth, requireRole('platform_admin'), controller.verify);
