import { Router } from 'express';
import { z } from 'zod';
import { findEnrollment } from '@a-health/database/enrollment';
import { unauthenticated, forbidden } from '@a-health/http';
import { createPaymentIntent } from '../services/intent.service.js';
import { createConsoleAdapter, createFlutterwaveAdapter } from '../adapters/provider.js';
import { env, paymentSettings } from '../config/env.js';
import { carriers } from '../services/policy.js';
import { prisma } from '@a-health/database';
import { settleVerifiedCharge } from '../services/settlement.service.js';
import { getBillReceipt } from '../services/receipt.service.js';
import { renderReceipt } from '../services/receipt-pdf.js';

const adapters=Object.fromEntries(carriers.map(provider=>[provider,paymentSettings.mode==='console'?createConsoleAdapter(provider):createFlutterwaveAdapter(provider,env.FLW_SECRET_KEY,env.FLW_ENVIRONMENT)]));
export function localRegistrationSimulationAllowed() {
  const url=new URL(env.DATABASE_URL);
  return env.NODE_ENV!=='production' && paymentSettings.mode==='console' &&
    ['localhost','127.0.0.1'].includes(url.hostname) && url.port==='55432' && url.pathname==='/ahealth_dev';
}
export const registrationPaymentRouter=Router();
registrationPaymentRouter.use('/payments/registration',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
registrationPaymentRouter.get('/payments/registration/receipt',async(req,res,next)=>{try{
  const record=await findEnrollment(req.header('Authorization')?.replace(/^Bearer /,'')??'');
  if(!record?.billId)throw unauthenticated('REGISTRATION_SESSION_EXPIRED','Verify your phone again to continue.');
  const receipt=await getBillReceipt(record.billId,{sub:record.userId,role:'patient'},true);
  const pdf=await renderReceipt(receipt);
  res.setHeader('Content-Disposition',`attachment; filename="${receipt.number}.pdf"`);
  res.type('application/pdf').send(pdf);
}catch(error){next(error);}});
registrationPaymentRouter.get('/payments/registration/options',async(req,res,next)=>{try{
  const r=await findEnrollment(req.header('Authorization')?.replace(/^Bearer /,'')??'');
  if(!r)throw unauthenticated('REGISTRATION_SESSION_EXPIRED','Verify your phone again to continue.');
  res.json({method:'mobile_money',providers:[...carriers],processor:paymentSettings.mode,environment:paymentSettings.environment,requires_email:paymentSettings.mode==='flutterwave'});
}catch(e){next(e);}});
registrationPaymentRouter.post('/payments/registration/simulate',async(req,res,next)=>{try{
  if(!localRegistrationSimulationAllowed())throw forbidden('FORBIDDEN','Local simulation is unavailable.');
  const r=await findEnrollment(req.header('Authorization')?.replace(/^Bearer /,'')??'');
  if(!r||!r.billId)throw unauthenticated('REGISTRATION_SESSION_EXPIRED','Verify your phone and complete your details.');
  const intent=await prisma.paymentIntent.findFirst({where:{billId:r.billId,processor:'console',environment:'simulated',status:{in:['processing','succeeded']}},orderBy:{createdAt:'desc'}});
  if(!intent)throw forbidden('REGISTRATION_INCOMPLETE','Start a simulated payment first.');
  await settleVerifiedCharge({reference:intent.id,transactionId:intent.providerTransactionId??`registration-demo-${intent.id}`,amount:4000,currency:'TZS',status:'succeeded'},'console','simulated');
  res.json({simulated:true});
}catch(e){next(e);}});
registrationPaymentRouter.post('/payments/registration/intents',async(req,res,next)=>{try{
  const r=await findEnrollment(req.header('Authorization')?.replace(/^Bearer /,'')??'');
  if(!r)throw unauthenticated('REGISTRATION_SESSION_EXPIRED','Verify your phone again to continue.');
  const input=z.object({provider:z.enum(['mpesa','tigo_pesa','airtel_money']),payer_phone:z.string().regex(/^\+255\d{9}$/),payer_email:z.email().max(150).optional()}).strict().parse(req.body);
  if(!r.profileCompletedAt||!r.billId||r.bill?.purpose!=='registration_fee'||Number(r.bill.amount)!==4000||r.bill.currency!=='TZS')throw forbidden('REGISTRATION_INCOMPLETE','Complete your registration details first.');
  res.status(201).json(await createPaymentIntent({sub:r.userId,role:'patient'},{...input,bill_id:r.billId,method:'mobile_money'},adapters));
}catch(e){next(e);}});
