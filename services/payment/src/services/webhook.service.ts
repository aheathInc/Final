import { prisma } from '@a-health/database';
import { unauthenticated,unprocessable,AppError } from '@a-health/http';
import { verifyHmacSignature } from './webhookAuth.js';
import { env,paymentSettings } from '../config/env.js';
import { createFlutterwaveAdapter } from '../adapters/provider.js';
import { verifyProviderSignature,type Carrier } from './policy.js';
import { settleVerifiedCharge } from './settlement.service.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Existing callback contract is retained ONLY for explicit console simulation. */
export async function handleWebhook(provider:string,rawBody:string,signature:string|undefined,payload:Record<string,unknown>){
 if(env.NODE_ENV==='production'||paymentSettings.mode!=='console')throw unauthenticated('TOKEN_INVALID','Simulation callback is disabled.');
 const secrets:Record<string,string>={mpesa:env.WEBHOOK_SECRET_MPESA,tigo_pesa:env.WEBHOOK_SECRET_TIGO_PESA,airtel_money:env.WEBHOOK_SECRET_AIRTEL_MONEY};
 if(!verifyHmacSignature(rawBody,signature,secrets[provider]??''))throw unauthenticated('TOKEN_INVALID','Webhook signature is not valid');
 const id=String(payload.provider_reference??'');if(!uuid.test(id))throw unprocessable('Invalid payment reference.');
 const i=await prisma.paymentIntent.findUnique({where:{id}});
 if(!i||i.provider!==provider||i.processor!=='console'||i.environment!=='simulated')throw unauthenticated('TOKEN_INVALID','Provider scope mismatch.');
 if(!['succeeded','failed','pending'].includes(String(payload.status))||!payload.transaction_id||payload.amount===undefined||payload.currency===undefined)throw unprocessable('Incomplete simulator callback.');
 return settleVerifiedCharge({reference:id,transactionId:String(payload.transaction_id),amount:payload.amount as number|string,currency:String(payload.currency),status:payload.status as 'succeeded'|'failed'|'pending'},'console','simulated');
}
export async function handleFlutterwaveWebhook(rawBody:string,signature:string|undefined,payload:Record<string,unknown>){
 if(paymentSettings.mode!=='flutterwave'||!verifyProviderSignature(rawBody,signature,env.FLW_WEBHOOK_SECRET,paymentSettings.scheme))throw unauthenticated('TOKEN_INVALID','Webhook signature is not valid');
 const data=payload.data as Record<string,unknown>|undefined;
 if(payload.event!=='charge.completed')return {handled:false};
 if(!data||!/^\d{1,20}$/.test(String(data.id)))throw unprocessable('Invalid provider transaction ID.');
 // Never trust callback amounts/status. Fetch authoritative provider record server-side.
 const adapter=createFlutterwaveAdapter('mpesa',env.FLW_SECRET_KEY,env.FLW_ENVIRONMENT);
 let charge;try{charge=await adapter.verify!(String(data.id));}catch{throw new AppError('SERVICE_UNAVAILABLE',503,'Payment verification unavailable. Retry callback later.');}
 if(!uuid.test(charge.reference))return {handled:false};
 return settleVerifiedCharge(charge,'flutterwave',env.FLW_ENVIRONMENT);
}
export async function reconcilePayment(intentId:string){
 const i=await prisma.paymentIntent.findUnique({where:{id:intentId}});
 if(!i||i.processor!=='flutterwave'||i.environment!==env.FLW_ENVIRONMENT||!['pending','processing'].includes(i.status)||paymentSettings.mode!=='flutterwave')return;
 const adapter=createFlutterwaveAdapter(i.provider as Carrier,env.FLW_SECRET_KEY,env.FLW_ENVIRONMENT);
 const charge=i.providerTransactionId?await adapter.verify!(i.providerTransactionId):await adapter.verifyReference!(i.id);
 return settleVerifiedCharge(charge,'flutterwave',env.FLW_ENVIRONMENT);
}
