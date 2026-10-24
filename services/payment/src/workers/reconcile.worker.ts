import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env,paymentSettings } from '../config/env.js';
import { reconcilePayment } from '../services/webhook.service.js';
const logger=createLogger('payment.reconcile');
export function startPaymentReconciliation(){
 if(paymentSettings.mode!=='flutterwave'||env.PAYMENT_RECONCILE_SECONDS===0)return undefined;
 let running=false;
 const timer=setInterval(()=>{if(running)return;running=true;
   void (async()=>{
     const rows=await prisma.paymentIntent.findMany({where:{processor:'flutterwave',environment:env.FLW_ENVIRONMENT,status:{in:['pending','processing']},createdAt:{lt:new Date(Date.now()-60_000)}},orderBy:[{lastVerifiedAt:{sort:'asc',nulls:'first'}},{createdAt:'asc'}],take:20});
     for(const row of rows){try{await reconcilePayment(row.id);}catch{logger.warn('Verification deferred',{intentId:row.id,code:'PROVIDER_RECONCILIATION_PENDING'});}
       await prisma.paymentIntent.updateMany({where:{id:row.id,status:{in:['processing','pending']}},data:{lastVerifiedAt:new Date()}});
     }
   })().catch(()=>logger.error('Reconciliation tick failed',{code:'PAYMENT_RECONCILIATION_ERROR'})).finally(()=>{running=false;});
 },env.PAYMENT_RECONCILE_SECONDS*1000);timer.unref();return timer;
}
