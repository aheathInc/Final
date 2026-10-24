import { prisma } from '@a-health/database';
import { appendAudit, conflict } from '@a-health/http';
import { matchesCharge,type VerifiedCharge } from './policy.js';
/** Only called using an authenticated provider lookup (or explicit non-production simulator callback). */
export async function settleVerifiedCharge(charge:VerifiedCharge,processor:'flutterwave'|'console',environment:'live'|'test'|'simulated'){
 return prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM payment_intents WHERE id=${charge.reference}::uuid FOR UPDATE`;
   const i=await tx.paymentIntent.findUnique({where:{id:charge.reference}});
   if(!i||i.processor!==processor||i.environment!==environment||!i.billId)return {handled:false};
   if(!matchesCharge(i,charge))throw conflict('STATE_TRANSITION_INVALID','Verified provider details do not match the payable.');
   if(i.status==='succeeded')return {handled:true};
   if(!['processing','pending'].includes(i.status))throw conflict('STATE_TRANSITION_INVALID','Late provider settlement requires reconciliation review.');
   if(charge.status==='pending'){await tx.paymentIntent.update({where:{id:i.id},data:{lastVerifiedAt:new Date()}});return {handled:true};}
   if(charge.status==='failed'){
     await tx.paymentIntent.update({where:{id:i.id},data:{status:'failed',lastVerifiedAt:new Date(),version:{increment:1}}});
     await appendAudit({action:'payment.provider_failed',entityType:'payment_intents',entityId:i.id,metadata:{processor,environment}},tx);
     return {handled:true};
   }
   await tx.$queryRaw`SELECT id FROM care_bills WHERE id=${i.billId}::uuid FOR UPDATE`;
   const bill=await tx.careBill.findUniqueOrThrow({where:{id:i.billId}});
   if(bill.status!=='due')throw conflict('PAYMENT_ALREADY_SETTLED','Bill already settled; manual reconciliation is required.');
   // A verified payment that arrives after quote expiry must still be accounted for.
   const payment=await tx.payment.create({data:{paymentIntentId:i.id,amount:i.amount,currency:i.currency,method:i.method,provider:i.provider,
     providerReference:i.providerReference,providerTransactionId:`${processor}:${environment}:${charge.transactionId}`,processor,environment,purpose:i.purpose,
     consultationId:i.consultationId,payerUserId:i.payerUserId,status:'succeeded',settledAt:new Date()}});
   await tx.paymentIntent.update({where:{id:i.id},data:{status:'succeeded',paymentId:payment.id,lastVerifiedAt:new Date(),providerTransactionId:charge.transactionId,version:{increment:1}}});
   await tx.careBill.update({where:{id:bill.id},data:{status:'paid',paidAt:new Date()}});
   if(i.payerUserId)await tx.notificationLog.create({data:{userId:i.payerUserId,channel:'sms',templateKey:environment==='live'?'payment.verified':'payment.simulated',payload:{reference:bill.reference}}});
   await appendAudit({actorUserId:i.payerUserId,action:'payment.provider_verified',entityType:'payments',entityId:payment.id,metadata:{billId:bill.id,processor,environment}},tx);
   return {handled:true};
 },{maxWait:10000,timeout:15000});
}
