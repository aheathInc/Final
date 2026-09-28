import { createAuthGuards } from '@a-health/http';
import { tokenService } from '../utils/jwt.js';

const guards = createAuthGuards(tokenService);

export const requireAuth = guards.requireAuth;
export const requireRole = guards.requireRole;
export const requireVerifiedClinician = guards.requireVerifiedClinician;
