import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import { createConsoleAdapter } from '../adapters/provider.js';
import { issueBill, listBills } from '../services/bill.service.js';
import { createPaymentIntent, getPaymentIntent, cancelPaymentIntent } from '../services/intent.service.js';
import { settleVerifiedCharge } from '../services/settlement.service.js';
import { refundPayment } from '../services/refund.service.js';
import { paymentSettings } from '../config/env.js';

// Changed contract: clients may no longer set prices or auto-settle cash/card.
// Fixtures are retained in the explicitly isolated schema for inspection.
const target = assertIsolatedLocalTestTarget(process.env);
if (paymentSettings.mode !== 'console') throw new Error('DB regression never charges a provider: select console.');
before(async () => { await verifyLocalTestIdentity(prisma,target); });
after(async () => { await prisma.$disconnect(); });
async function fixture() {
  const phone=()=>`+2557${randomInt(10_000_000,99_999_999)}`;
  const p=await prisma.user.create({data:{phoneNumber:phone(),role:'patient',status:'active',fullName:'Synthetic Billing Patient'}});
  const profile=await prisma.patientProfile.create({data:{userId:p.id,fullName:'Synthetic Billing Patient'}});
  const staff=await prisma.user.create({data:{phoneNumber:phone(),role:'clinician',status:'active',fullName:'Synthetic Billing Clinician'}});
  const doctor=await prisma.clinicianProfile.create({data:{userId:staff.id,licenseNumber:`TEST-${randomUUID()}`,specialty:'general_practice',verificationStatus:'verified'}});
  const thread=await prisma.careThread.create({data:{patientProfileId:profile.id}});
  const visit=await prisma.consultationRequest.create({data:{careThreadId:thread.id,patientProfileId:profile.id,assignedClinicianId:doctor.id,channel:'app',urgencyLevel:'routine',triageRuleVersion:'test-billing',status:'in_progress',slaDeadlineAt:new Date(Date.now()+3600000)}});
  const caller={sub:p.id,role:'patient'},clinician={sub:staff.id,role:'clinician'};
  const input={consultation_id:visit.id,amount:15000,currency:'TZS',title:'Consultation'};
  const bill=await issueBill(clinician,input);
  const adapters={mpesa:createConsoleAdapter('mpesa')};
  const checkout={bill_id:bill.id,method:'mobile_money',provider:'mpesa' as const,payer_phone:p.phoneNumber};
  return {caller,clinician,input,bill,adapters,checkout,visit};
}
async function checkedCharge(f:Awaited<ReturnType<typeof fixture>>) {
 const dto=await createPaymentIntent(f.caller,f.checkout,f.adapters);
 const row=await prisma.paymentIntent.findUniqueOrThrow({where:{id:dto.id}});
 return {dto,row,charge:{reference:row.id,transactionId:row.providerTransactionId!,amount:15000,currency:'TZS',status:'succeeded' as const}};
}
describe('server-issued consultation billing',()=>{
 it('only assigned verified clinician or platform admin may issue',async()=>{const f=await fixture();await assert.rejects(()=>issueBill(f.caller,f.input));await assert.rejects(()=>issueBill({sub:randomUUID(),role:'clinician'},f.input));});
 it('idempotent issue returns the same bill; changing price conflicts',async()=>{const f=await fixture();assert.equal((await issueBill(f.clinician,f.input)).id,f.bill.id);await assert.rejects(()=>issueBill(f.clinician,{...f.input,amount:1}));});
 it('only payer sees own bills',async()=>{const f=await fixture(),other=await fixture();assert.ok((await listBills(f.caller)).data.some(x=>x.id===f.bill.id));assert.ok(!(await listBills(other.caller)).data.some(x=>x.id===f.bill.id));});
 it('rejects patient-supplied prices',async()=>{const f=await fixture();await assert.rejects(()=>createPaymentIntent(f.caller,{...f.checkout,amount:1},f.adapters));});
 it('rejects cash/card client success shortcut',async()=>{const f=await fixture();for(const method of ['cash','card'])await assert.rejects(()=>createPaymentIntent(f.caller,{...f.checkout,method},f.adapters));});
 it('rejects another payer and expired bills',async()=>{const f=await fixture(),other=await fixture();await assert.rejects(()=>createPaymentIntent(other.caller,f.checkout,f.adapters));await prisma.careBill.update({where:{id:f.bill.id},data:{expiresAt:new Date(0)}});await assert.rejects(()=>createPaymentIntent(f.caller,f.checkout,f.adapters));});
 it('reserves one intent under actual concurrent requests',async()=>{const f=await fixture();const [a,b]=await Promise.all([createPaymentIntent(f.caller,f.checkout,f.adapters),createPaymentIntent(f.caller,f.checkout,f.adapters)]);assert.equal(a.id,b.id);assert.equal(await prisma.paymentIntent.count({where:{billId:f.bill.id}}),1);});
 it('pending does not create receipt; non-owner cannot read intent',async()=>{const f=await fixture();const {dto}=await checkedCharge(f);assert.equal(dto.status,'processing');assert.equal(dto.environment,'simulated');assert.equal(await prisma.payment.count({where:{paymentIntentId:dto.id}}),0);await assert.rejects(()=>getPaymentIntent(dto.id,{sub:randomUUID(),role:'patient'}));});
 it('cannot cancel an in-flight provider request locally',async()=>{const f=await fixture(),{dto}=await checkedCharge(f);await assert.rejects(()=>cancelPaymentIntent(dto.id,f.caller,{}));});
 it('rejects wrong amount/currency/transaction',async()=>{const f=await fixture(),{charge}=await checkedCharge(f);for(const edit of [{amount:1},{currency:'USD'},{transactionId:'wrong'}])await assert.rejects(()=>settleVerifiedCharge({...charge,...edit},'console','simulated'));assert.equal(await prisma.payment.count({where:{paymentIntentId:charge.reference}}),0);});
 it('deduplicates actual concurrent settlement and keeps notification/audit atomic',async()=>{const f=await fixture(),{charge}=await checkedCharge(f);await Promise.all([settleVerifiedCharge(charge,'console','simulated'),settleVerifiedCharge(charge,'console','simulated')]);assert.equal(await prisma.payment.count({where:{paymentIntentId:charge.reference}}),1);assert.equal((await prisma.careBill.findUniqueOrThrow({where:{id:f.bill.id}})).status,'paid');assert.equal(await prisma.notificationLog.count({where:{userId:f.caller.sub,templateKey:'payment.simulated'}}),1);});
 it('live callback cannot settle simulated intent',async()=>{const f=await fixture(),{charge}=await checkedCharge(f);assert.equal((await settleVerifiedCharge(charge,'flutterwave','live')).handled,false);});
 it('late success after failed state is blocked for manual reconciliation',async()=>{const f=await fixture(),{charge}=await checkedCharge(f);await settleVerifiedCharge({...charge,status:'failed'},'console','simulated');await assert.rejects(()=>settleVerifiedCharge(charge,'console','simulated'));});
 it('real-provider refund is refused rather than falsely recorded',async()=>{const f=await fixture(),{charge}=await checkedCharge(f);await settleVerifiedCharge(charge,'console','simulated');const p=await prisma.payment.findUniqueOrThrow({where:{paymentIntentId:charge.reference}});await prisma.payment.update({where:{id:p.id},data:{processor:'flutterwave',environment:'test'}});await assert.rejects(()=>refundPayment(p.id,{sub:f.clinician.sub,role:'platform_admin'},{reason:'Synthetic test'},{}));assert.equal(await prisma.paymentRefund.count({where:{paymentId:p.id}}),0);});
});
