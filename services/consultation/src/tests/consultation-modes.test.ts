import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import { createConsultationSchema } from '../types/consultation.types.js';
import { createConsultation, offerConsultation, acceptConsultation } from '../services/consultation.service.js';
import { getQueue, getQueueStatus } from '../services/queue.service.js';
import { issueBill } from '../../../payment/src/services/bill.service.js';
import { createPaymentIntent } from '../../../payment/src/services/intent.service.js';
import { createConsoleAdapter } from '../../../payment/src/adapters/provider.js';
import * as calls from '../services/call.service.js';
import { bus } from '../events.js';

const target = assertIsolatedLocalTestTarget(process.env);
before(async () => { await verifyLocalTestIdentity(prisma, target); });
after(async () => { await bus.close(); await prisma.$disconnect(); });
const meta = { requestId: 'synthetic-consultation-modes' };
async function fixture(specialty: 'general_practice' | 'surgery' = 'general_practice') {
  const phone = () => `TEST-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const user = await prisma.user.create({ data: { phoneNumber: phone(), role: 'patient', status: 'active', fullName: 'SYNTHETIC mode patient' } });
  const patient = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'SYNTHETIC mode patient' } });
  const facility = await prisma.facility.create({ data: { name: 'SYNTHETIC mode hospital', type: 'hospital' } });
  const staff = await prisma.user.create({ data: { phoneNumber: phone(), role: 'clinician', status: 'active', fullName: 'SYNTHETIC mode clinician' } });
  const doctor = await prisma.clinicianProfile.create({ data: { userId: staff.id, facilityId: facility.id, licenseNumber: `MODE-${randomUUID()}`, specialty, verificationStatus: 'verified' } });
  return { user, patient, facility, staff, doctor, caller: { sub: user.id, role: 'patient', ppid: patient.id }, clinician: { sub: staff.id, role: 'clinician', cpid: doctor.id } };
}
async function request(f: Awaited<ReturnType<typeof fixture>>, mode: 'hospital' | 'remote', modality = 'chat') {
  const c = await createConsultation(f.caller, { channel: 'app', clinician_id: f.doctor.id, consultation_mode: mode,
    ...(mode === 'hospital' ? { facility_id: f.facility.id, modality: 'in_person' } : { modality }), symptom_text: 'SYNTHETIC verification only' }, meta);
  await offerConsultation(c.id);
  return c;
}

test('request schema rejects missing hospital and incompatible modalities', () => {
  for (const extra of [{ consultation_mode: 'hospital' }, { consultation_mode: 'hospital', facility_id: randomUUID(), modality: 'video' },
    { consultation_mode: 'remote', modality: 'in_person' }, { consultation_mode: 'remote', modality: 'async' }, { consultation_mode: 'home' }]) {
    assert.equal(createConsultationSchema.safeParse({ channel: 'app', ...extra }).success, false);
  }
});
test('hospital request persists destination, scopes offers, carries no bill and rejects call/fee', async () => {
  const f = await fixture(); const other = await fixture(); const c = await request(f, 'hospital');
  assert.equal(c.consultation_mode, 'hospital'); assert.equal(c.modality, 'in_person'); assert.equal(c.consultation_fee_amount, 0);
  assert.equal(c.facility_name, f.facility.name);
  const otherQueue = (await getQueue(other.clinician, { scope: 'offered', limit: 100 })).data as { consultation: { id: string } }[];
  assert.ok(!otherQueue.some(e => e.consultation.id === c.id));
  await acceptConsultation(c.id, f.clinician, meta);
  assert.equal(await prisma.careBill.count({ where: { consultationId: c.id } }), 0);
  await assert.rejects(() => issueBill(f.clinician, { consultation_id: c.id, title: 'Consultation', amount: 5000, currency: 'TZS' }), {code:'CONSULTATION_FEE_NOT_APPLICABLE'});
  await assert.rejects(() => calls.getCall(c.id, f.caller), /only for the selected remote/);
  assert.equal((await getQueueStatus(c.id, f.caller)).facility_id, f.facility.id);
});
test('hospital cannot target a clinician at another or inactive facility', async () => {
  const f = await fixture(), other = await fixture();
  await assert.rejects(() => createConsultation(f.caller, { channel: 'app', consultation_mode: 'hospital', facility_id: other.facility.id, clinician_id: f.doctor.id }, meta), /does not practise/);
  await prisma.facility.update({ where: { id: f.facility.id }, data: { isActive: false } });
  await assert.rejects(() => request(f, 'hospital'), /unavailable/);
});
for (const specialty of ['general_practice', 'surgery'] as const) {
  test(`remote ${specialty} issues the exact server price once on acceptance`, async () => {
    const f = await fixture(specialty), amount = specialty === 'general_practice' ? 5000 : 8000;
    const c = await request(f, 'remote', 'video'); assert.equal(c.consultation_fee_amount, amount);
    assert.equal(await prisma.careBill.count({ where: { consultationId: c.id } }), 0);
    await acceptConsultation(c.id, f.clinician, meta);
    const bill = await prisma.careBill.findUniqueOrThrow({ where: { consultationId: c.id } });
    assert.equal(Number(bill.amount), amount); assert.equal(bill.status, 'due');
    assert.equal(await prisma.payment.count({ where: { consultationId: c.id } }), 0);
    await assert.rejects(() => acceptConsultation(c.id, f.clinician, meta));
    assert.equal(await prisma.careBill.count({ where: { consultationId: c.id } }), 1);
    await assert.rejects(() => issueBill(f.clinician, { consultation_id: c.id, title: 'Remote consultation', amount: 1, currency: 'TZS' }), /server-calculated/);
  });
}
test('new requests from older clients still receive remote fee policy', async () => {
  const f = await fixture();
  const c = await createConsultation(f.caller, { channel: 'app', clinician_id: f.doctor.id }, meta);
  assert.equal(c.consultation_mode, 'remote'); assert.equal(c.consultation_fee_policy, 'remote-tzs-v1');
  await offerConsultation(c.id); await acceptConsultation(c.id, f.clinician, meta);
  assert.equal(Number((await prisma.careBill.findUniqueOrThrow({ where: { consultationId: c.id } })).amount), 5000);
});
test('historic hospital fee cannot enter checkout', async () => {
  const f = await fixture(), c = await request(f, 'hospital');
  const bill = await prisma.careBill.create({ data: { consultationId: c.id, reference: `TEST-${randomUUID().slice(0, 20)}`, payerUserId: f.user.id, issuedById: f.staff.id,
    patientProfileId: f.patient.id, title: 'Legacy synthetic bill', amount: 5000, currency: 'TZS', purpose: 'consultation_fee', expiresAt: new Date(Date.now() + 60000) } });
  await assert.rejects(() => createPaymentIntent(f.caller, { bill_id: bill.id, method: 'mobile_money', provider: 'mpesa', payer_phone: '+255700000000' }, { mpesa: createConsoleAdapter('mpesa') }), {code:'CONSULTATION_FEE_NOT_APPLICABLE'});
});
test('call signalling requires assignment, isolates patients, handles retry and clears ended SDP', async () => {
  const f = await fixture(), stranger = await fixture(), c = await request(f, 'remote', 'voice');
  await assert.rejects(() => calls.getCall(c.id, f.caller), /after the doctor accepts/);
  await acceptConsultation(c.id, f.clinician, meta);
  await assert.rejects(() => calls.getCall(c.id, stranger.caller), /Only this consultation/);
  const input = { call_id: randomUUID(), sdp: 'v=0\r\ns=synthetic test offer\r\n' };
  assert.equal((await calls.getCall(c.id, f.caller)).can_start, false);
  assert.equal((await calls.getCall(c.id, f.clinician)).can_start, true);
  await assert.rejects(() => calls.offerCall(c.id, f.caller, input), /Only the assigned doctor/);
  const started = await calls.offerCall(c.id, f.clinician, input);
  assert.equal(started.call?.is_caller, true);
  assert.equal((await calls.offerCall(c.id, f.clinician, input)).call?.id, input.call_id);
  await assert.rejects(() => calls.offerCall(c.id, f.caller, { ...input, call_id: randomUUID() }), /Only the assigned doctor/);
  await assert.rejects(() => calls.offerCall(c.id, f.clinician, { ...input, call_id: randomUUID() }), /already an active call/);
  await assert.rejects(() => calls.answerCall(c.id, input.call_id, f.clinician, 'v=0\r\ns=answer\r\n'), /no longer available/);
  const answered = await calls.answerCall(c.id, input.call_id, f.caller, 'v=0\r\ns=answer\r\n');
  assert.ok(answered.call?.answer);
  await calls.endCall(c.id, input.call_id, f.caller);
  const row = await prisma.consultationCall.findUniqueOrThrow({ where: { id: input.call_id } });
  assert.equal(row.offer, null); assert.equal(row.answer, null); assert.ok(row.endedAt);
  assert.equal((await calls.getCall(c.id, f.clinician)).call, null);
});
test('chat consultations cannot invoke audio/video signalling', async () => {
  const f = await fixture(), c = await request(f, 'remote', 'chat'); await acceptConsultation(c.id, f.clinician, meta);
  await assert.rejects(() => calls.offerCall(c.id, f.caller, { call_id: randomUUID(), sdp: 'v=0\r\ns=offer\r\n' }), /only for the selected remote/);
});

test('an explicitly waived remote fee never produces an automatic bill',async()=>{
 const f=await fixture(),c=await request(f,'remote');
 await prisma.consultationRequest.update({where:{id:c.id},data:{consultationFeeAmount:0}});
 await acceptConsultation(c.id,f.clinician,meta);
 assert.equal(await prisma.careBill.count({where:{consultationId:c.id}}),0);
});
