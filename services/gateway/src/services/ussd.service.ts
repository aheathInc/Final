import { prisma } from '@a-health/database';
import { env } from '../config/env.js';
import { mintTokenForPhone } from './internalAuth.js';
import { contextKey,sealContext,openContext,requestDigest,stableRequestKey } from './ussd-security.js';
import { ussdStep,USSD_MAIN_MENU,type UssdApi } from './ussd-flow.js';
export interface UssdResult{response:string;terminate:boolean}
const key=contextKey(env.USSD_CONTEXT_KEY,env.GATEWAY_SHARED_SECRET,env.NODE_ENV==='production');
const urls={auth:env.AUTH_SERVICE_URL,consultation:env.CONSULTATION_SERVICE_URL,doctor:env.DOCTOR_SERVICE_URL,appointment:env.APPOINTMENT_SERVICE_URL,payment:env.PAYMENT_SERVICE_URL};
async function request(service:keyof typeof urls,path:string,method:string,body:unknown,token?:string,idempotency?:string){
 const res=await fetch(urls[service]+path,{method,redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!res.ok)throw new Error('UPSTREAM_REJECTED');if(res.status===204)return {};return res.json();
}
/** Default dependencies use real Auth/Consultation/Appointment/Payment services; injectable only in tests. */
export async function handleUssdSession(sessionId:string,phoneNumber:string,text:string,deps:{request?:typeof request;mint?:typeof mintTokenForPhone}={}):Promise<UssdResult>{
 const call=deps.request??request,mint=deps.mint??mintTokenForPhone,now=new Date();
 if(sessionId.length>100||text.length>2048)return {response:'Ombi si halali. Anza upya.',terminate:true};
 const digest=requestDigest(sessionId,phoneNumber,text),parts=text?text.split('*'):[],choice=parts.at(-1)??'';
 return prisma.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ussd:${sessionId}`},0))`;
   let row=await tx.ussdSession.findUnique({where:{sessionId}});
   if(row&&row.phoneNumber!==phoneNumber)return {response:'Session si sahihi.',terminate:true};
   if(row&&row.expiresAt<=now)return {response:'Muda wa session umeisha. Piga tena.',terminate:true};
   if(!row){
     if(text)return {response:'Anza session mpya bila jibu la awali.',terminate:true};
     row=await tx.ussdSession.create({data:{sessionId,phoneNumber,menuState:'start',context:{},expiresAt:new Date(now.getTime()+env.USSD_SESSION_TTL_SECONDS*1000)}});
     // Display consent before SMS or creating identity.
     const response='A-Health\nThibitisha namba kwa OTP ili kuendelea. Taarifa zitatumika kwa huduma yako.\n1. Tuma OTP\n0. Toka';
     const ctx={phone:phoneNumber,depth:0,digest,last:{response,terminate:false}};
     await tx.ussdSession.update({where:{sessionId},data:{context:sealContext(ctx,key,sessionId+phoneNumber)}});return {response,terminate:false};
   }
   let ctx:Record<string,any>;try{ctx=openContext(row.context,key,sessionId+phoneNumber);}catch{return {response:'Anza session mpya.',terminate:true};}
   if(ctx.digest===digest)return ctx.last;
   if(row.menuState==='closed')return {response:'Session imefungwa. Piga tena.',terminate:true};
   if(parts.length!==Number(ctx.depth)+1)return {response:'Mpangilio wa majibu si sahihi. Anza session mpya.',terminate:true};
   let state=row.menuState,result:UssdResult;
   try{
     if(choice==='0'){state='closed';result={response:'Asante kwa kutumia A-Health.',terminate:true};}
     else if(state==='start'){
       if(choice!=='1')result={response:'Chagua 1 kutuma OTP au 0 kutoka.',terminate:false};
       else {const c=await call('auth','/auth/otp/request','POST',{phone_number:phoneNumber,channel:'sms'});
         ctx.challengeId=c.challenge_id;state='otp';result={response:c.delivery_status==='simulated'?'MAJARIBIO: ingiza OTP ya mazingira ya majaribio.':'Ingiza OTP ya tarakimu 6 iliyotumwa kwa SMS.',terminate:false};}
     }else if(state==='otp'){
       if(!/^\d{6}$/.test(choice))result={response:'Ingiza tarakimu 6 za OTP.',terminate:false};
       else {
         const session=await call('auth','/auth/otp/verify','POST',{challenge_id:ctx.challengeId,code:choice,device_id:`ussd-${stableRequestKey(sessionId,phoneNumber,'device')}`});
         if(session.user?.role!=='patient'||session.user?.phone_number!==phoneNumber)throw new Error('NOT_PATIENT');
         // Revoke the temporary refresh token; subsequent requests mint short-lived tokens after this verified session.
         await call('auth','/auth/logout','POST',{},session.access_token);
         ctx.verified=true;delete ctx.challengeId;state='root';result={response:USSD_MAIN_MENU,terminate:false};
       }
     }else{
       if(ctx.verified!==true)throw new Error('NOT_VERIFIED');
       const auth=await mint(phoneNumber,true);if(!auth)throw new Error('ACCOUNT_INACTIVE');
       const api:UssdApi=(service,path,method,body,idempotency)=>call(service,path,method,body,auth.token,idempotency);
       const step=await ussdStep(state,ctx,choice,api,stableRequestKey(sessionId,phoneNumber,state),now);
       ctx=step.context;state=step.state;result={response:step.response,terminate:step.terminate};
     }
   }catch{
     // Never include upstream error text, OTP or clinical text in the response/log.
     if(state==='otp')result={response:'OTP haijathibitishwa. Omba session mpya ikiwa code imeisha muda.',terminate:false};
     else {result={response:'Huduma haijapatikana sasa. Hakuna mafanikio yaliyothibitishwa. Anza tena au wasiliana na kituo.',terminate:true};state='closed';}
   }
   ctx=result.terminate?{depth:parts.length,digest,last:result}:{...ctx,depth:parts.length,digest,last:result};
   await tx.ussdSession.update({where:{sessionId},data:{menuState:state,context:sealContext(ctx,key,sessionId+phoneNumber)}});
   return result;
 },{maxWait:5000,timeout:20000});
}
