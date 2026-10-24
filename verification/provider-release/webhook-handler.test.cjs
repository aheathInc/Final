'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {load}=require('../lib/load-typescript.cjs');const errors=load('packages/http/src/errors.ts');const policy=load('services/payment/src/services/policy.ts');const sms=load('packages/http/src/integrations/sms.ts');
const secret=crypto.randomBytes(32).toString('hex');
function harness({scheme='verif_hash',mode='flutterwave',fail=false,verifiedId=77}={}){
 const calls=[],settlements=[];const reference=crypto.randomUUID();
 const source=load('services/payment/src/services/webhook.service.ts',{
 '@a-health/database':{prisma:{}},'@a-health/http':errors,'./webhookAuth.js':{verifyHmacSignature:()=>false},
 '../config/env.js':{env:{NODE_ENV:'test',FLW_WEBHOOK_SECRET:secret,FLW_SECRET_KEY:'fixture',FLW_ENVIRONMENT:'test'},paymentSettings:{mode,scheme}},
 '../adapters/provider.js':{createFlutterwaveAdapter:()=>({verify:async id=>{calls.push(id);if(fail)throw new Error('sensitive upstream');return{transactionId:String(verifiedId),reference,amount:15000,currency:'TZS',status:'pending'};}})},
 './policy.js':policy,'./settlement.service.js':{settleVerifiedCharge:async (...args)=>{settlements.push(args);return{handled:true};}},
 });
 return{...source,calls,settlements,reference};
}
test('unsigned webhook cannot call provider or settle',async()=>{const h=harness();await assert.rejects(()=>h.handleFlutterwaveWebhook('{}',undefined,{event:'charge.completed',data:{id:77}}));assert.equal(h.calls.length,0);assert.equal(h.settlements.length,0);});
test('v3 authenticated callback re-queries, ignores attacker-declared success and amount',async()=>{const h=harness(),body={event:'charge.completed',data:{id:77,status:'successful',amount:1}};await h.handleFlutterwaveWebhook(JSON.stringify(body),secret,body);assert.deepEqual(h.calls,['77']);assert.equal(h.settlements[0][0].status,'pending');assert.equal(h.settlements[0][0].amount,15000);assert.equal(h.settlements[0][1],'flutterwave');assert.equal(h.settlements[0][2],'test');});
test('HMAC webhook checks exact raw bytes without falling back to secret header',async()=>{const h=harness({scheme:'hmac_sha256'}),body={event:'charge.completed',data:{id:77}},raw=JSON.stringify(body),signature=crypto.createHmac('sha256',secret).update(raw).digest('base64');await assert.rejects(()=>h.handleFlutterwaveWebhook(raw,secret,body));await h.handleFlutterwaveWebhook(raw,signature,body);assert.equal(h.calls.length,1);});
test('upstream verification failure is 503 and never settles or leaks body',async()=>{const h=harness({fail:true});await assert.rejects(()=>h.handleFlutterwaveWebhook('{}',secret,{event:'charge.completed',data:{id:77}}),e=>e.statusCode===503&&!String(e).includes('sensitive upstream'));assert.equal(h.settlements.length,0);});
test('malformed provider ID cannot be placed in provider URL',async()=>{const h=harness();await assert.rejects(()=>h.handleFlutterwaveWebhook('{}',secret,{event:'charge.completed',data:{id:'../secret'}}));assert.equal(h.calls.length,0);});
test('unsupported provider event is acknowledged without settlement',async()=>{const h=harness();assert.deepEqual(await h.handleFlutterwaveWebhook('{}',secret,{event:'unrelated'}),{handled:false});assert.equal(h.calls.length,0);});
test('real callback disabled in console mode',async()=>{const h=harness({mode:'console'});await assert.rejects(()=>h.handleFlutterwaveWebhook('{}',secret,{event:'charge.completed',data:{id:77}}));assert.equal(h.calls.length,0);});
for(const statusCode of [100,102])test('SMS accepted status '+statusCode+' never means handset delivered',async()=>{const config=sms.smsSettings({NODE_ENV:'test',SMS_PROVIDER:'africastalking',AT_ENVIRONMENT:'sandbox',AT_USERNAME:'sandbox',AT_API_KEY:'fixture',SMS_SENDER_ID:'DEMO'});const r=await sms.sendSms(config,'+255700000001','Test',crypto.randomUUID(),async()=>new Response(JSON.stringify({SMSMessageData:{Recipients:[{number:'+255700000001',statusCode,messageId:'test'}]}})));assert.equal(r.delivery,'accepted');});
test('test payment config cannot send with live-looking secret key',()=>{assert.throws(()=>policy.resolvePaymentSettings({NODE_ENV:'test',MOBILE_MONEY_PROVIDER:'flutterwave',FLW_ENVIRONMENT:'test',FLW_SECRET_KEY:'FLWSECK-live-fixture',FLW_WEBHOOK_SECRET:secret}));assert.equal(policy.resolvePaymentSettings({NODE_ENV:'test',MOBILE_MONEY_PROVIDER:'flutterwave',FLW_ENVIRONMENT:'test',FLW_SECRET_KEY:'FLWSECK_TEST-fixture',FLW_WEBHOOK_SECRET:secret}).scheme,'verif_hash');});

test('shared test guard rejects encoded development database without isolated schema',()=>{const shared=load('packages/database/src/test-safety.ts');assert.throws(()=>shared.assertIsolatedLocalTestTarget({NODE_ENV:'test',DATABASE_URL:'postgresql://ahealth:fixture@127.0.0.1:55432/ahealth%5Fdev?schema=public'}));});
