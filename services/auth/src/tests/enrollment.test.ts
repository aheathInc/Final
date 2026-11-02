import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import { findEnrollment } from '@a-health/database/enrollment';
import { requestOtp, verifyOtp, setPassword, refreshSession } from '../services/auth.service.js';
import { registrationStatus, saveRegistrationProfile, completeRegistration, patientPasswordLogin, REGISTRATION_CONSENT } from '../services/enrollment.service.js';
import { registrationPaymentRouter } from '../../../payment/src/routes/registration.routes.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { settleVerifiedCharge } from '../../../payment/src/services/settlement.service.js';
import { codeOf, testPhone, meta } from './helpers.js';
import { env as authEnv } from '../config/env.js';
const target=assertIsolatedLocalTestTarget(process.env);
let server: ReturnType<ReturnType<typeof express>['listen']>, base='';
before(async()=>{
  await verifyLocalTestIdentity(prisma,target);
  const app=express();app.use(express.json());app.use(registrationPaymentRouter);
  app.get('/protected',requireAuth,(_req,res)=>res.json({ok:true}));
  app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.statusCode??422).json({code:e.code??'VALIDATION_FAILED'}));
  await new Promise<void>((resolve,reject)=>{server=app.listen(0,'127.0.0.1',error=>error?reject(error):resolve());});
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await prisma.$disconnect();});
async function begin(phone=testPhone()) {
  const otp=await requestOtp(phone,'sms');
  const session=await verifyOtp(otp.challenge_id,codeOf(otp),'registration-test',meta);
  assert.ok('registration_token' in session);return {token:session.registration_token,phone};
}
const profile=(kin=testPhone())=>({full_name:'Synthetic Test Patient',date_of_birth:'1995-07-10',sex:'female',residence:'Synthetic location',next_of_kin_name:'Synthetic Test Contact',next_of_kin_phone:kin,consent_version:REGISTRATION_CONSENT});
const password='Calm rivers carry clouds!';
async function pay(token:string,phone:string){
  const response=await fetch(`${base}/payments/registration/intents`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({provider:'mpesa',payer_phone:phone})});
  assert.equal(response.status,201);return await response.json() as any;
}
async function settle(intent:any){const record=await prisma.paymentIntent.findUniqueOrThrow({where:{id:intent.id}});await settleVerifiedCharge({reference:intent.id,transactionId:record.providerTransactionId!,amount:4000,currency:'TZS',status:'succeeded'},'console','simulated');}

test('new OTP only grants restricted enrollment; expiry and token rotation preserve progress',async()=>{
  const {token,phone}=await begin();
  assert.equal((await registrationStatus(token)).step,'profile');
  assert.equal((await fetch(`${base}/protected`,{headers:{Authorization:`Bearer ${token}`}})).status,401);
  const r=await findEnrollment(token);assert.ok(r);assert.equal(r.user.status,'pending_verification');
  assert.equal(await prisma.refreshToken.count({where:{userId:r.userId}}),0);
  await assert.rejects(()=>completeRegistration(token,password,undefined,meta),{code:'REGISTRATION_INCOMPLETE'});
  const saved=await saveRegistrationProfile(token,profile());
  const resumed=await begin(phone);assert.equal(await findEnrollment(token),null);
  assert.equal((await registrationStatus(resumed.token)).bill!.id,saved.bill!.id);
  await prisma.patientEnrollment.update({where:{userId:r.userId},data:{expiresAt:new Date(0)}});
  await assert.rejects(()=>registrationStatus(resumed.token),{code:'REGISTRATION_SESSION_EXPIRED'});
});

test('profile validates dates, consent, verified phone and distinct next of kin; bill is unique',async()=>{
  const {token,phone}=await begin();
  for(const invalid of [{...profile(),date_of_birth:'2999-01-01'},{...profile(),consent_version:'old'},{...profile(),phone_number:testPhone()},{...profile(phone)}])await assert.rejects(()=>saveRegistrationProfile(token,invalid));
  const [a,b]=await Promise.all([saveRegistrationProfile(token,profile()),saveRegistrationProfile(token,profile())]);
  assert.equal(a.bill!.id,b.bill!.id);assert.equal(a.bill!.amount,4000);assert.equal(a.bill!.currency,'TZS');
  const r=await findEnrollment(token);assert.equal(r!.user.phoneNumber,phone);assert.equal(r!.user.patientProfile!.nextOfKinName,'Synthetic Test Contact');
});

test('payment rejects client prices and foreign bill IDs; retries reserve one pending intent',async()=>{
  const a=await begin(),b=await begin();await saveRegistrationProfile(a.token,profile());const other=await saveRegistrationProfile(b.token,profile());
  for(const extra of [{amount:1},{bill_id:other.bill!.id},{status:'paid'}]){
    const res=await fetch(`${base}/payments/registration/intents`,{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify({provider:'mpesa',payer_phone:a.phone,...extra})});assert.equal(res.status,422);
  }
  const intents=await Promise.all([pay(a.token,a.phone),pay(a.token,a.phone)]);assert.equal(intents[0].id,intents[1].id);
  await assert.rejects(()=>completeRegistration(a.token,password,undefined,meta),{code:'REGISTRATION_INCOMPLETE'});
  await assert.rejects(()=>settleVerifiedCharge({reference:intents[0].id,transactionId:'bad-amount',amount:1,currency:'TZS',status:'succeeded'},'console','simulated'));
});

test('paid enrollment resumes security without another fee; completion is single-use and password login works',async()=>{
  const a=await begin();await saveRegistrationProfile(a.token,profile());const intent=await pay(a.token,a.phone);await settle(intent);await settle(intent);
  const b=await begin(a.phone);assert.equal((await registrationStatus(b.token)).step,'security');
  const session=await completeRegistration(b.token,password,'test-device',meta);assert.ok(session.access_token);assert.equal(session.user.status,'active');
  await assert.rejects(()=>completeRegistration(b.token,password,'test-device',meta),{code:'REGISTRATION_SESSION_EXPIRED'});
  assert.equal(await prisma.payment.count({where:{payerUserId:session.user.id,purpose:'registration_fee'}}),1);
  const login=await patientPasswordLogin(a.phone,password,undefined,meta);assert.ok(login.access_token);
  const refreshed=await refreshSession(login.refresh_token,meta);
  assert.equal(JSON.parse(Buffer.from(refreshed.access_token.split('.')[1]!,'base64url').toString()).amr,'password');
  await assert.rejects(()=>setPassword(session.user.id,'password','Another long phrase for recovery!',undefined,meta),{code:'CURRENT_PASSWORD_REQUIRED'});
  const otp=await requestOtp(a.phone,'sms');const existing=await verifyOtp(otp.challenge_id,codeOf(otp),undefined,meta);assert.ok('access_token' in existing);
  assert.equal(await prisma.careBill.count({where:{payerUserId:session.user.id,purpose:'registration_fee'}}),1);
  await setPassword(session.user.id,'otp','Another long phrase for recovery!',undefined,meta);
  await assert.rejects(()=>refreshSession(refreshed.refresh_token,meta),{code:'TOKEN_INVALID'});
  assert.ok((await patientPasswordLogin(a.phone,'Another long phrase for recovery!',undefined,meta)).access_token);
});

test('password attempts lock persistently; suspended users cannot resume or login',async()=>{
  const a=await begin();await saveRegistrationProfile(a.token,profile());await settle(await pay(a.token,a.phone));const s=await completeRegistration(a.token,password,undefined,meta);
  for(let i=0;i<5;i++)await assert.rejects(()=>patientPasswordLogin(a.phone,'wrong password',undefined,meta),{code:'UNAUTHENTICATED'});
  await assert.rejects(()=>patientPasswordLogin(a.phone,password,undefined,meta),{code:'ACCOUNT_LOCKED'});
  await prisma.user.update({where:{id:s.user.id},data:{status:'suspended',lockedUntil:null}});
  await assert.rejects(()=>patientPasswordLogin(a.phone,password,undefined,meta),{code:'REGISTRATION_REQUIRED'});
  const otp=await requestOtp(a.phone,'sms');await assert.rejects(()=>verifyOtp(otp.challenge_id,codeOf(otp),undefined,meta),{code:'FORBIDDEN'});
});

test('local simulation is explicitly marked and cannot settle another registration',async()=>{
  const a=await begin();await saveRegistrationProfile(a.token,profile());await pay(a.token,a.phone);
  const res=await fetch(`${base}/payments/registration/simulate`,{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:'{}'});
  assert.equal(res.status,200);assert.equal((await res.json() as any).simulated,true);
  assert.equal((await registrationStatus(a.token)).payment!.environment,'simulated');
  const savedEnvironment=authEnv.NODE_ENV;
  try {
    authEnv.NODE_ENV='production';
    await assert.rejects(()=>completeRegistration(a.token,password,undefined,meta),{code:'REGISTRATION_INCOMPLETE'});
  } finally { authEnv.NODE_ENV=savedEnvironment; }
  const b=await begin();const noBill=await fetch(`${base}/payments/registration/simulate`,{method:'POST',headers:{Authorization:`Bearer ${b.token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(noBill.status,401);
});
