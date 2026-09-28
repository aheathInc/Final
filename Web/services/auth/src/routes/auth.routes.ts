import { Router } from 'express';
import * as controller from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { idempotency } from '../middlewares/idempotency.middleware.js';

export const authRouter = Router();

// Registration creates state, so it carries Idempotency-Key. A phone that
// retried three times over a bad connection must produce one account.
authRouter.post('/auth/register/patient', idempotency, controller.registerPatient);
authRouter.post('/auth/register/clinician', idempotency, controller.registerClinician);

// OTP request is naturally repeatable and rate limited instead.
authRouter.post('/auth/otp/request', controller.requestOtp);
authRouter.post('/auth/otp/verify', controller.verifyOtp);

authRouter.post('/auth/login', controller.login);
authRouter.post('/auth/token/refresh', controller.refresh);
authRouter.post('/auth/logout', requireAuth, controller.logout);

// Set, change and reset are one endpoint. You may set a password if you can
// prove the current one, or prove control of the registered phone by having
// signed in with a code — the token's amr claim decides which.
authRouter.post('/auth/password/set', requireAuth, controller.setPassword);

export const userRouter = Router();

userRouter.get('/users/me', requireAuth, controller.getMe);
userRouter.patch('/users/me', requireAuth, controller.updateMe);

// /users/me/dependents belongs to services/patient — this service owns
// identity, not clinical profile management.
