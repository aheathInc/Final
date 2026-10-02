import type { NextFunction, Request, Response } from 'express';
import { badRequest, pathParam } from '@a-health/http';
import * as intents from '../services/intent.service.js';
import * as refunds from '../services/refund.service.js';
import { handleWebhook } from '../services/webhook.service.js';
import { createConsoleAdapter, type ProviderAdapter } from '../adapters/provider.js';
import { env } from '../config/env.js';
import {
  createIntentSchema, listPaymentsQuery, refundSchema, webhookProviderParam,
} from '../types/payment.types.js';

const caller = (req: Request) => ({ sub: req.auth?.sub, role: req.auth?.role });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

// Resolved once at startup. Real deployments would register one adapter per
// enabled provider here; the console adapter is the safe default for dev.
const adapters: Record<string, ProviderAdapter> =
  env.MOBILE_MONEY_PROVIDER === 'console' ? { mpesa: createConsoleAdapter('mpesa') } : {};

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const createIntent = handle(
  (req) => intents.createPaymentIntent(caller(req), createIntentSchema.parse(req.body), adapters), 201,
);

export const getIntent = handle((req) =>
  intents.getPaymentIntent(pathParam(req, 'payment_intent_id'), caller(req)));

export const cancelIntent = handle((req, res) =>
  intents.cancelPaymentIntent(pathParam(req, 'payment_intent_id'), caller(req), meta(req, res)));

export const listPayments = handle((req) => intents.listPayments(caller(req), listPaymentsQuery.parse(req.query)));

export const refund = handle(
  (req, res) => refunds.refundPayment(pathParam(req, 'payment_id'), caller(req), refundSchema.parse(req.body), meta(req, res)), 201,
);

/**
 * Raw body is required here, not parsed JSON — the HMAC is computed over the
 * exact bytes the provider sent, and re-serialising a parsed object is not
 * guaranteed to reproduce that byte-for-byte.
 */
export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const provider = webhookProviderParam.parse(pathParam(req, 'provider'));
    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (typeof rawBody !== 'string') {
      throw badRequest('VALIDATION_FAILED', 'Raw body was not captured for signature verification');
    }
    const signature = req.header('X-Webhook-Signature');
    await handleWebhook(provider, rawBody, signature, req.body as Record<string, unknown>);
    res.status(200).json({ acknowledged: true });
  } catch (err) {
    next(err);
  }
}
