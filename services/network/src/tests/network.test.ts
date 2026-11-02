import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import type { AppError } from '@a-health/http';
import * as discussions from '../services/discussion.service.js';
import * as opinions from '../services/secondOpinion.service.js';

const testTarget = assertIsolatedLocalTestTarget(process.env);

before(async () => { await verifyLocalTestIdentity(prisma, testTarget); });

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const communityIds: string[] = [];
const threadIds: string[] = [];
const discussionIds: string[] = [];
const opinionIds: string[] = [];

after(async () => {
  for (const id of opinionIds) {
    await prisma.secondOpinion.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of discussionIds) {
    await prisma.discussionReply.deleteMany({ where: { discussionId: id } }).catch(() => undefined);
    await prisma.discussion.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of communityIds) {
    await prisma.community.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Network Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return { sub: user.id, role: 'clinician', cpid: profile.id };
}

async function makeCommunity() {
  const community = await prisma.community.create({ data: { name: `Test Community ${randomUUID().slice(0, 8)}`, specialty: 'general_practice' } });
  communityIds.push(community.id);
  return community;
}

async function makeThread() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Thread Patient' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Thread Patient' } });
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  return thread;
}

describe('discussions', () => {
  it('creates and reads a discussion with its replies', async () => {
    const clinician = await makeClinician();
    const community = await makeCommunity();
    await discussions.joinCommunity(community.id, clinician);

    const discussion = await discussions.createDiscussion(
      clinician, { community_id: community.id, title: 'Test', body: 'A question about dosing.' }, meta,
    );
    discussionIds.push(discussion.id);

    await discussions.replyToDiscussion(discussion.id, clinician, 'Try this approach.', meta);

    const fetched = await discussions.getDiscussion(discussion.id, clinician);
    assert.equal(fetched.reply_count, 1);
    assert.equal(fetched.replies.length, 1);
  });

  it('requires a care_thread_id for a case discussion', async () => {
    const clinician = await makeClinician();
    const community = await makeCommunity();
    await discussions.joinCommunity(community.id, clinician);

    await assert.rejects(
      () => discussions.createDiscussion(
        clinician, { community_id: community.id, title: 'Case', body: 'x', is_case_discussion: true }, meta,
      ),
    );
  });

  it('never exposes patient identity through a case discussion', async () => {
    const clinician = await makeClinician();
    const community = await makeCommunity();
    await discussions.joinCommunity(community.id, clinician);
    const thread = await makeThread();
    await prisma.careThread.update({where:{id:thread.id},data:{primaryClinicianId:clinician.cpid}});

    const discussion = await discussions.createDiscussion(
      clinician,
      { community_id: community.id, title: 'Case', body: 'De-identified question.', is_case_discussion: true, care_thread_id: thread.id },
      meta,
    );
    discussionIds.push(discussion.id);

    assert.ok(!('patient' in discussion));
    assert.ok(!('patient_name' in discussion));
  });

  it('refuses a non-clinician creating a discussion', async () => {
    const community = await makeCommunity();
    await assert.rejects(
      () => discussions.createDiscussion(
        { sub: randomUUID(), role: 'patient' }, { community_id: community.id, title: 'x', body: 'y' }, meta,
      ),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});

describe('second opinions', () => {
  it('requests, claims, and answers a second opinion', async () => {
    const requester = await makeClinician();
    const specialist = await makeClinician();
    const thread = await makeThread();

    const opinion = await opinions.requestSecondOpinion(
      requester, { care_thread_id: thread.id, specialty: 'dermatology', question: 'Is this concerning?' }, meta,
    );
    opinionIds.push(opinion.id);
    assert.equal(opinion.status, 'open');

    const claimed = await opinions.claimSecondOpinion(opinion.id, specialist, meta);
    assert.equal(claimed.status, 'claimed');
    assert.equal(claimed.answered_by_id, specialist.cpid);

    const answered = await opinions.answerSecondOpinion(opinion.id, specialist, 'Benign, monitor.', meta);
    assert.equal(answered.status, 'answered');
    assert.ok(answered.answered_at);
  });

  it('refuses a second claim on an already-claimed opinion', async () => {
    const requester = await makeClinician();
    const first = await makeClinician();
    const second = await makeClinician();
    const thread = await makeThread();

    const opinion = await opinions.requestSecondOpinion(
      requester, { care_thread_id: thread.id, specialty: 'internal_medicine', question: 'q' }, meta,
    );
    opinionIds.push(opinion.id);
    await opinions.claimSecondOpinion(opinion.id, first, meta);

    await assert.rejects(
      () => opinions.claimSecondOpinion(opinion.id, second, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses an answer from someone other than the claimant', async () => {
    const requester = await makeClinician();
    const claimant = await makeClinician();
    const stranger = await makeClinician();
    const thread = await makeThread();

    const opinion = await opinions.requestSecondOpinion(
      requester, { care_thread_id: thread.id, specialty: 'psychiatry', question: 'q' }, meta,
    );
    opinionIds.push(opinion.id);
    await opinions.claimSecondOpinion(opinion.id, claimant, meta);

    await assert.rejects(
      () => opinions.answerSecondOpinion(opinion.id, stranger, 'answer', meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('refuses answering an opinion that is still open', async () => {
    const requester = await makeClinician();
    const thread = await makeThread();
    const opinion = await opinions.requestSecondOpinion(
      requester, { care_thread_id: thread.id, specialty: 'oncology', question: 'q' }, meta,
    );
    opinionIds.push(opinion.id);

    await assert.rejects(
      () => opinions.answerSecondOpinion(opinion.id, requester, 'answer', meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

it('threads replies within one group discussion and notifies only eligible recipients', async () => {
 const author=await makeClinician(), responder=await makeClinician(), observer=await makeClinician(), muted=await makeClinician(), outsider=await makeClinician();
 const group=await makeCommunity();
 for(const c of [author,responder])await discussions.joinCommunity(group.id,c);
 await discussions.joinCommunity(group.id,observer,'all');await discussions.joinCommunity(group.id,muted,'muted');
 const d=await discussions.createDiscussion(author,{community_id:group.id,title:'Clinical discussion',body:'Synthetic question'},meta);discussionIds.push(d.id);
 assert.equal((await discussions.listNotifications(observer)).unread_count,1);
 assert.equal((await discussions.listNotifications(responder)).unread_count,0);
 await assert.rejects(()=>discussions.getDiscussion(d.id,outsider));
 await assert.rejects(()=>discussions.replyToDiscussion(d.id,outsider,'Denied',meta));
 const first=await discussions.replyToDiscussion(d.id,responder,'First response',meta);
 const nested=await discussions.replyToDiscussion(d.id,author,'Response to first',meta,first.id);
 const root=await discussions.replyToDiscussion(d.id,observer,'Separate group-wide response',meta);
 const fetched=await discussions.getDiscussion(d.id,author);
 assert.equal(fetched.replies.find(r=>r.id===nested.id)?.parent_reply_id,first.id);
 assert.equal(fetched.replies.find(r=>r.id===root.id)?.parent_reply_id,null);
 assert.equal((await discussions.listNotifications(muted)).unread_count,0);
 assert.equal((await discussions.listNotifications(outsider)).unread_count,0);
 const notices=await discussions.listNotifications(author);assert.equal(notices.unread_count,2);
 await assert.rejects(()=>discussions.markNotificationRead(notices.data[0]!.id,responder));
 await discussions.markNotificationRead(notices.data[0]!.id,author);
 assert.equal((await discussions.listNotifications(author)).unread_count,1);
 const other=await discussions.createDiscussion(author,{community_id:group.id,title:'Separate discussion',body:'Separate'},meta);discussionIds.push(other.id);
 await assert.rejects(()=>discussions.replyToDiscussion(other.id,author,'Wrong thread',meta,first.id));
 await assert.rejects(()=>prisma.discussionReply.create({data:{discussionId:other.id,authorClinicianId:author.cpid,body:'Direct wrong parent',parentReplyId:first.id}}));
 const page=await discussions.listReplies(d.id,author,{limit:1});assert.equal(page.data.length,1);assert.ok(page.meta.next_cursor);
 const next=await discussions.listReplies(d.id,author,{limit:1,cursor:page.meta.next_cursor!});assert.notEqual(next.data[0]?.id,page.data[0]?.id);
 await discussions.leaveCommunity(group.id,responder);await assert.rejects(()=>discussions.getDiscussion(d.id,responder));assert.equal((await discussions.listNotifications(responder)).unread_count,0);
 await prisma.user.update({where:{id:author.sub},data:{status:'suspended'}});await assert.rejects(()=>discussions.listCommunities(author));await assert.rejects(()=>discussions.getDiscussion(d.id,author));
});
