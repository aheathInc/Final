import { prisma, type PaymentIntent } from '@a-health/database';
import { appendAudit,conflict,cursorArgs,forbidden,notFound,toCursorPage,unprocessable } from '@a-health/http';
import { env } from '../config/env.js';
import type { ProviderAdapter } from '../adapters/provider.js';
import type { Carrier } from './policy.js';
import { isFreeConsultation } from '@a-health/database/consultation-billing';
export interface Caller{sub?:string;role?:string}
export interface Meta{ip?:string|null;requestId?:string|null}
export function serialiseIntent(i:PaymentIntent){return {id:i.id,bill_id:i.billId,amount:Number(i.amount),currency:i.currency,method:i.method,provider:i.provider,purpose:i.purpose,
 consultation_id:i.consultationId,dispensing_id:i.dispensingId,insurance_claim_id:i.insuranceClaimId,status:i.status,provider_reference:i.providerReference,
 client_action:i.clientAction??null,payment_id:i.paymentId,processor:i.processor,environment:i.environment,created_at:i.createdAt.toISOString(),expires_at:i.expiresAt?.toISOString()??null,version:i.version};}
export async function createPaymentIntent(caller:Caller,input:{bill_id?:string;method?:string;provider?:Carrier;payer_phone?:string;payer_email?:string;amount?:number;currency?:string;purpose?:string;[key:string]:unknown},adapters:Record<string,ProviderAdapter>){
 if(!caller.sub||caller.role!=='patient')throw forbidden('ROLE_NOT_PERMITTED','Patients may pay their own server-issued bills.');
 if(!input.bill_id||input.amount!==undefined||input.currency!==undefined||input.purpose!==undefined)throw unprocessable('A server-issued bill_id is required. The client cannot set the price.');
 if(input.method!=='mobile_money'||!input.provider)throw conflict('PAYMENT_METHOD_UNAVAILABLE','Only configured mobile-money checkout is available.');
 if(!input.payer_phone||!/^\+255\d{9}$/.test(input.payer_phone))throw unprocessable('A valid Tanzania mobile-money number is required.','payer_phone');
 const adapter=adapters[input.provider];if(!adapter)throw conflict('PAYMENT_METHOD_UNAVAILABLE','Selected provider is unavailable.');
 if(adapter.processor==='flutterwave'&&(!input.payer_email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payer_email)))throw unprocessable('The selected provider requires a payer email.','payer_email');
 const reserved=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM care_bills WHERE id=${input.bill_id}::uuid FOR UPDATE`;
   const bill=await tx.careBill.findUnique({where:{id:input.bill_id}});
   if(!bill||bill.payerUserId!==caller.sub)throw notFound('Bill not found.');
   if(bill.purpose==='consultation_fee'){
     if(!bill.consultationId)throw conflict('CONSULTATION_FEE_NOT_APPLICABLE','A consultation reference is required before payment.');
     const consultation=await tx.consultationRequest.findUnique({where:{id:bill.consultationId}});
     if(!consultation||isFreeConsultation(consultation))throw conflict('CONSULTATION_FEE_NOT_APPLICABLE','This consultation is free or unavailable. Its consultation bill cannot be paid.');
   }
   if(bill.status!=='due')throw conflict('PAYMENT_ALREADY_SETTLED','This bill is not payable.');
   if(bill.expiresAt<=new Date())throw conflict('STATE_TRANSITION_INVALID','Bill has expired. Contact the service desk.');
   const unresolved=await tx.paymentIntent.findFirst({where:{billId:bill.id,status:{in:['pending','requires_action','processing']}}});
   if(unresolved) return {intent:unresolved,existing:true};
   const intent=await tx.paymentIntent.create({data:{billId:bill.id,amount:bill.amount,currency:bill.currency,method:'mobile_money',purpose:bill.purpose,
     consultationId:bill.consultationId,payerUserId:caller.sub,payerPhone:input.payer_phone,provider:adapter.provider,processor:adapter.processor,environment:adapter.environment,
     status:'processing',expiresAt:new Date(Date.now()+env.INTENT_TTL_MINUTES*60000),clientAction:{type:'pending',message:'Awaiting provider acknowledgement.'}}});
   await tx.paymentIntent.update({where:{id:intent.id},data:{providerReference:intent.id}});
   await appendAudit({actorUserId:caller.sub,action:'payment.intent_requested',entityType:'payment_intents',entityId:intent.id,metadata:{billId:bill.id,processor:adapter.processor,environment:adapter.environment}},tx);
   return {intent:{...intent,providerReference:intent.id},existing:false};
 });
 if(reserved.existing)return serialiseIntent(reserved.intent);
 try{
   const result=await adapter.initiate({amount:Number(reserved.intent.amount),currency:reserved.intent.currency,payerPhone:input.payer_phone,reference:reserved.intent.id,email:input.payer_email});
   // Callback can arrive before the initiation response. Do not overwrite settlement.
   await prisma.paymentIntent.updateMany({where:{id:reserved.intent.id,status:'processing'},data:{providerTransactionId:result.transactionId??null,clientAction:result.clientAction as never,version:{increment:1}}});
 }catch{
   // A timeout can occur AFTER the wallet was charged: never free the bill for a duplicate charge.
   await prisma.paymentIntent.updateMany({where:{id:reserved.intent.id,status:'processing'},data:{clientAction:{type:'reconciling',message:'Provider response is uncertain. Do not pay again; we are checking the transaction.'},version:{increment:1}}});
 }
 return serialiseIntent(await prisma.paymentIntent.findUniqueOrThrow({where:{id:reserved.intent.id}}));
}
export async function getPaymentIntent(id:string,caller:Caller){
 const i=await prisma.paymentIntent.findUnique({where:{id}});if(!i)throw notFound('Payment intent not found');
 if(!caller.sub||(caller.role!=='platform_admin'&&i.payerUserId!==caller.sub))throw forbidden('NOT_RESOURCE_OWNER','This payment intent is not yours');return serialiseIntent(i);
}
export async function cancelPaymentIntent(id:string,caller:Caller,_meta:Meta){
 const i=await prisma.paymentIntent.findUnique({where:{id}});if(!i)throw notFound('Payment intent not found');
 if(!caller.sub||i.payerUserId!==caller.sub)throw forbidden('NOT_RESOURCE_OWNER','This payment intent is not yours');
 // In-flight wallet requests cannot be cancelled locally: late success remains possible.
 throw conflict('STATE_TRANSITION_INVALID','Reject the request in your wallet. A-Health will reconcile the provider result.');
}
export async function listPayments(caller:Caller,query:{consultation_id?:string;status?:string;cursor?:string;limit:number}){
 if(!caller.sub||!['patient','platform_admin'].includes(caller.role??''))throw forbidden('ROLE_NOT_PERMITTED','Not permitted.');
 const rows=await prisma.payment.findMany({where:{...(caller.role==='platform_admin'?{}:{payerUserId:caller.sub}),...(query.consultation_id?{consultationId:query.consultation_id}:{}),...(query.status?{status:query.status as never}:{})},orderBy:{settledAt:'desc'},...cursorArgs(query.cursor,query.limit)});
 return toCursorPage(rows,query.limit,p=>({id:p.id,payment_intent_id:p.paymentIntentId,amount:Number(p.amount),currency:p.currency,method:p.method,provider:p.provider,provider_reference:p.providerReference,purpose:p.purpose,consultation_id:p.consultationId,payer_user_id:p.payerUserId,status:p.status,refunded_amount:Number(p.refundedAmount),settled_at:p.settledAt.toISOString(),version:p.version,processor:p.processor,environment:p.environment,verified_provider_transaction_id:p.providerTransactionId,
   refund_available:p.processor==='console'&&env.NODE_ENV!=='production'}));
}
