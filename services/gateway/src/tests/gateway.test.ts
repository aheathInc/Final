import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import { mintTokenForPhone } from '../services/internalAuth.js';
import { handleUssdSession } from '../services/ussd.service.js';

const target=assertIsolatedLocalTestTarget(process.env);
before(async()=>{await verifyLocalTestIdentity(prisma,target);});

const users: string[] = [];
const sessionIds: string[] = [];

after(async () => {
  for (const id of sessionIds) {
    await prisma.ussdSession.deleteMany({ where: { sessionId: id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeActivePatient() {
  const phone = `+2557${randomInt(10_000_000, 99_999_999)}`;
  const user = await prisma.user.create({
    data: { phoneNumber: phone, role: 'patient', status: 'active', fullName: 'Gateway Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Gateway Test' } });
  return { phone, user, profile };
}

describe('internal auth', () => {
  it('mints a token for an active, registered phone', async () => {
    const { phone, profile } = await makeActivePatient();
    const auth = await mintTokenForPhone(phone);
    assert.ok(auth);
    assert.equal(auth!.claims.ppid, profile.id);
  });

  it('returns null for an unregistered phone', async () => {
    const auth = await mintTokenForPhone('+255700000000');
    assert.equal(auth, null);
  });

  it('returns null for a suspended account', async () => {
    const phone = `+2557${randomInt(10_000_000, 99_999_999)}`;
    const user = await prisma.user.create({ data: { phoneNumber: phone, role: 'patient', status: 'suspended', fullName: 'Suspended' } });
    users.push(user.id);

    const auth = await mintTokenForPhone(phone);
    assert.equal(auth, null);
  });

  it('does not mint Patient-channel tokens for active staff accounts', async () => {
    const user = await prisma.user.create({
      data: {
        phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
        role: 'clinician',
        status: 'active',
        fullName: 'Gateway Staff Test',
      },
    });
    users.push(user.id);

    assert.equal(await mintTokenForPhone(user.phoneNumber), null);
  });
});

describe('OTP-authenticated USSD with encrypted context', () => {
  it('shows a verification prompt, not patient records, on a fresh session', async () => {
    const sessionId = `sess-${randomUUID()}`;sessionIds.push(sessionId);
    const result = await handleUssdSession(sessionId, '+255700000001', '');
    assert.match(result.response, /OTP/);assert.equal(result.terminate, false);
    const row=await prisma.ussdSession.findUniqueOrThrow({where:{sessionId}});
    assert.equal((row.context as {v:number}).v,1);
  });
  it('binds the session to its original phone number', async()=>{
    const sessionId=`sess-${randomUUID()}`;sessionIds.push(sessionId);
    await handleUssdSession(sessionId,'+255700000001','');
    assert.equal((await handleUssdSession(sessionId,'+255700000002','1')).terminate,true);
  });
  it('expires the session instead of silently reopening it', async()=>{
    const sessionId=`sess-${randomUUID()}`;sessionIds.push(sessionId);
    await handleUssdSession(sessionId,'+255700000001','');
    await prisma.ussdSession.update({where:{sessionId},data:{expiresAt:new Date(0)}});
    assert.equal((await handleUssdSession(sessionId,'+255700000001','1')).terminate,true);
  });
  it('does not resend OTP when the aggregator retries the same callback', async()=>{
    const sessionId=`sess-${randomUUID()}`;sessionIds.push(sessionId);let sent=0;
    const request=async()=>{sent++;return{challenge_id:randomUUID(),delivery_status:'simulated'};};
    await handleUssdSession(sessionId,'+255700000001','',{request});
    const [a,b]=await Promise.all([handleUssdSession(sessionId,'+255700000001','1',{request}),handleUssdSession(sessionId,'+255700000001','1',{request})]);
    assert.equal(sent,1);assert.equal(a.response,b.response);
  });
  it('unverified phone token does not claim OTP authentication', async()=>{
    const {phone}=await makeActivePatient();assert.equal((await mintTokenForPhone(phone))?.claims.amr,'gateway');
  });
});
