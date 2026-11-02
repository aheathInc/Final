import type { NextFunction, Request, Response } from 'express';
import { badRequest, pathParam } from '@a-health/http';
import * as intents from '../services/intent.service.js';
import * as refunds from '../services/refund.service.js';
import { handleWebhook } from '../services/webhook.service.js';
import { createConsoleAdapter, createFlutterwaveAdapter, type ProviderAdapter } from '../adapters/provider.js';
import { env, paymentSettings } from '../config/env.js';
import * as bills from '../services/bill.service.js';
import { carriers } from '../services/policy.js';
import { handleFlutterwaveWebhook } from '../services/webhook.service.js';
import { getBillReceipt } from '../services/receipt.service.js';
import { renderReceipt } from '../services/receipt-pdf.js';
import { z } from 'zod';
import {
  createIntentSchema, issueBillSchema, listPaymentsQuery, refundSchema, webhookProviderParam,
} from '../types/payment.types.js';

const caller = (req: Request) => ({ sub: req.auth?.sub, role: req.auth?.role });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

// Resolved once at startup. Real deployments would register one adapter per
// enabled provider here; the console adapter is the safe default for dev.
const adapters: Record<string,ProviderAdapter> = Object.fromEntries(carriers.map(provider => [provider, paymentSettings.mode==='console'?createConsoleAdapter(provider):createFlutterwaveAdapter(provider,env.FLW_SECRET_KEY,env.FLW_ENVIRONMENT)]));

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
    const buffer = (req as Request & { rawBody?: Buffer }).rawBody;
    const rawBody = buffer?.toString('utf8');
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

export const issueBill=handle(req=>bills.issueBill(caller(req),issueBillSchema.parse(req.body)),201);
export const listBills=handle(req=>bills.listBills(caller(req)));
export async function downloadBillReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    const receipt = await getBillReceipt(z.uuid().parse(pathParam(req, 'bill_id')), caller(req));
    const pdf = await renderReceipt(receipt);
    res.setHeader('Content-Disposition', `attachment; filename="${receipt.number}.pdf"`);
    res.type('application/pdf').send(pdf);
  } catch (error) { next(error); }
}
export const options=handle(async()=>({method:'mobile_money',providers:[...carriers],processor:paymentSettings.mode,environment:paymentSettings.environment,requires_email:paymentSettings.mode==='flutterwave'}));
export const reconcile=handle(async(req)=>{
  const id=pathParam(req,'payment_intent_id');await intents.getPaymentIntent(id,caller(req));
  // A user-triggered refresh is read-only. Background worker/webhook perform verification.
  return intents.getPaymentIntent(id,caller(req));
});
export async function flutterwaveWebhook(req:Request,res:Response,next:NextFunction){
 try{const raw=(req as Request&{rawBody?:Buffer}).rawBody;if(!raw)throw badRequest('VALIDATION_FAILED','Raw body missing');
 const signature=req.header(paymentSettings.scheme==='hmac_sha256'?'flutterwave-signature':'verif-hash');
 await handleFlutterwaveWebhook(raw.toString('utf8'),signature,req.body);res.status(200).json({acknowledged:true});}catch(error){next(error);}
}
