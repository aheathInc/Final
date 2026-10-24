import { randomUUID } from 'node:crypto';
import { smallJson } from '@a-health/http/sms';
import type { Carrier, VerifiedCharge } from '../services/policy.js';
export interface InitiateResult { providerReference:string; transactionId?:string; clientAction:Record<string,unknown> }
export interface ProviderAdapter {
 readonly provider:Carrier; readonly processor:'console'|'flutterwave'; readonly environment:'simulated'|'test'|'live';
 initiate(input:{amount:number;currency:string;payerPhone:string;reference:string;email?:string}):Promise<InitiateResult>;
 verify?(transactionId:string):Promise<VerifiedCharge>;
 verifyReference?(reference:string):Promise<VerifiedCharge>;
}
export function createConsoleAdapter(provider:Carrier):ProviderAdapter {
 return {provider,processor:'console',environment:'simulated',async initiate(input){
   if(process.env.NODE_ENV==='production')throw new Error('Console payments forbidden in production');
   return {providerReference:input.reference,transactionId:`sim-${randomUUID()}`,
     clientAction:{type:'simulation',simulated:true,message:'Simulation only. No wallet prompt or money transfer was sent.'}};
 }};
}
/** Pin to v3 Tanzania charge/verify contracts. Never accepts amount or success from the mobile client. */
export function createFlutterwaveAdapter(provider:Carrier,key:string,environment:'test'|'live',transport:typeof fetch=fetch):ProviderAdapter {
 const networks:Record<Carrier,string>={mpesa:'Vodafone',tigo_pesa:'Tigo',airtel_money:'Airtel'};
 const request=async(path:string,init:RequestInit={})=>{
   const response=await transport(`https://api.flutterwave.com/v3/${path}`,{...init,redirect:'error',signal:AbortSignal.timeout(12_000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'}});
   if(!response.ok)throw new Error('PAYMENT_PROVIDER_UNAVAILABLE');
   const json=await smallJson(response);if(json.status!=='success'||!json.data||typeof json.data!=='object')throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID');
   return json.data as Record<string,unknown>;
 };
 const charge=(d:Record<string,unknown>):VerifiedCharge=>{
   if(!Number.isSafeInteger(Number(d.id))||Number(d.id)<=0||typeof d.tx_ref!=='string'||typeof d.currency!=='string'||!['number','string'].includes(typeof d.amount))throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID');
   return {transactionId:String(d.id),reference:d.tx_ref,amount:d.amount as string|number,currency:d.currency,
     status:d.status==='successful'?'succeeded':(['failed','cancelled'].includes(String(d.status))?'failed':'pending')};
 };
 return {provider,processor:'flutterwave',environment,
   async initiate(input){
     if(!input.email)throw new Error('Payment provider requires payer email.');
     const d=await request('charges?type=mobile_money_tanzania',{method:'POST',body:JSON.stringify({
       amount:input.amount,currency:input.currency,phone_number:input.payerPhone,email:input.email,tx_ref:input.reference,network:networks[provider],
     })});
     if(d.tx_ref!==input.reference||!Number.isSafeInteger(Number(d.id))||Number(d.id)<=0)throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID');
     return {providerReference:input.reference,transactionId:String(d.id),clientAction:{type:'wallet_authorization',environment,
       message:'Authorize using your mobile-money provider. Never enter a wallet PIN in A-Health.'}};
   },
   async verify(id){if(!/^\d{1,20}$/.test(id))throw new Error('Invalid provider transaction');const result=charge(await request(`transactions/${id}/verify`));if(result.transactionId!==id)throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID');return result;},
   async verifyReference(ref){const result=charge(await request(`transactions/verify_by_reference?tx_ref=${encodeURIComponent(ref)}`));if(result.reference!==ref)throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID');return result;},
 };
}
