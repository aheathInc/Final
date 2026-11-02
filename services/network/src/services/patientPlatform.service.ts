import { prisma, type Prisma } from '@a-health/database';
import { appendAudit, forbidden, notFound, unprocessable } from '@a-health/http';

export const SOCIAL_CONSENT = 'health-community-2026-10-v1';
export const SOCIAL_TERMS = 'Use an alias. Other members can read approved posts; moderators review submissions and reports. Do not share patient identifiers, prescriptions or private records. Peer chat is optional, for adults, and requires both people to accept. Reported messages are shared with moderators. This service is not monitored continuously and is not emergency care.';
type Caller = {sub: string; role: string};
type Db = Prisma.TransactionClient;
function deny(message = 'This action is not available for this account.') { throw forbidden('ROLE_NOT_PERMITTED', message); }
async function actor(db: Db, c: Caller, admin = false) {
  const user = await db.user.findFirst({where:{id:c.sub,role:c.role as never,status:'active'}});
  if (!user || (admin ? c.role !== 'platform_admin' : !['patient','clinician','platform_admin'].includes(c.role))) deny();
  if (c.role === 'clinician' && !await db.clinicianProfile.findFirst({where:{userId:c.sub,verificationStatus:'verified'}})) deny();
  return user!;
}
async function profile(db: Db, id: string, peer = false) {
  const p = await db.patientSocialProfile.findUnique({where:{userId:id}});
  const u = await db.user.findUnique({where:{id},select:{status:true,role:true}});
  if (!p || p.suspended || p.consentVersion !== SOCIAL_CONSENT || u?.status !== 'active') deny('Community consent is required; suspended accounts cannot participate.');
  if (u?.role === 'clinician' && !await db.clinicianProfile.findFirst({where:{userId:id,verificationStatus:'verified'}})) deny();
  if (!['patient','clinician'].includes(u!.role)) deny();
  if (peer) {
    const patient = await db.patientProfile.findUnique({where:{userId:id},select:{dateOfBirth:true}});
    const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear()-18);
    if (u!.role !== 'patient' || !p!.peerEnabled || !patient?.dateOfBirth || patient.dateOfBirth > cutoff) deny('Peer chat requires two consenting adult patients with a recorded date of birth.');
  }
  return p!;
}
async function member(db: Db, spaceId: string, userId: string) {
  await profile(db,userId);
  if (!await db.healthSpaceMember.findFirst({where:{spaceId,userId,space:{active:true}}})) deny('Join this community before reading or contributing.');
}
async function blocked(db: Db, a: string, b: string) {
  return !!await db.patientSocialBlock.findFirst({where:{OR:[{userId:a,targetId:b},{userId:b,targetId:a}]}});
}
async function peerAccess(db: Db, c: Caller, id: string, active = true) {
  const chat = await db.peerConversation.findUnique({where:{id}});
  if (!chat || ![chat.requesterId,chat.recipientId].includes(c.sub)) throw notFound('Conversation not found');
  await profile(db,chat.requesterId,true); await profile(db,chat.recipientId,true);
  const memberships = await db.healthSpaceMember.findMany({where:{userId:chat.requesterId,space:{active:true}},select:{spaceId:true}});
  if (!await db.healthSpaceMember.findFirst({where:{userId:chat.recipientId,spaceId:{in:memberships.map(m=>m.spaceId)},space:{active:true}}})) deny('Peer chat requires a shared active community.');
  if (await blocked(db,chat.requesterId,chat.recipientId) || (active && chat.status !== 'accepted')) deny('This conversation is not active.');
  return chat;
}
async function audit(db: Db, c: Caller, action: string, entity: string, id: string) {
  await appendAudit({actorUserId:c.sub,action,entityType:entity,entityId:id,reason:c.role==='platform_admin'?'Authorized patient platform review':null},db);
}
async function notice(db: Db, userId: string, key: string, id: string) {
  await db.notificationLog.create({data:{userId,channel:'app' as never,templateKey:key,payload:{id}}});
}
async function invalidatePeers(db:Db,userId:string) {
  const chats=await db.peerConversation.findMany({where:{OR:[{requesterId:userId},{recipientId:userId}]}});
  for(const chat of chats) {
    const event=JSON.stringify({event:'patient.access_changed',entity:'peer_conversations',id:chat.id,careThreadId:chat.id,audienceUserIds:[chat.requesterId,chat.recipientId]});
    await db.$executeRaw`SELECT pg_notify('ahealth_events', ${event})`;
  }
}
async function rate(db: Db, c: Caller, kind: 'post'|'message'|'report'|'feedback') {
  const since = new Date(Date.now()-60_000);
  const n = kind==='post' ? await db.healthSpacePost.count({where:{authorId:c.sub,createdAt:{gte:since}}}) : kind==='message' ? await db.peerMessage.count({where:{senderId:c.sub,createdAt:{gte:since}}}) : kind==='report' ? await db.patientSocialReport.count({where:{reporterId:c.sub,createdAt:{gte:since}}}) : await db.patientFeedback.count({where:{userId:c.sub,createdAt:{gte:since}}});
  if (n >= (kind==='message'?30:5)) throw unprocessable('RATE_LIMITED','Please wait a minute before sending again.');
}
async function publicPost(db:Db, p: {authorId:string;[key:string]:unknown}) {
  const author = await db.patientSocialProfile.findUnique({where:{userId:p.authorId}});
  const clinician = await db.clinicianProfile.findFirst({where:{userId:p.authorId,verificationStatus:'verified',user:{status:'active',role:'clinician'}}});
  return {...p,authorId:undefined,reviewedBy:undefined,author_alias:author?.alias ?? 'Member',author_role:clinician?'clinician':'patient',peer_available:!!author?.peerEnabled && !author.suspended};
}
// One transaction lock serializes consent withdrawal, blocks, approvals and sends.
// It prevents a concurrent send from passing an old consent/membership check.
export async function platformAction(c: Caller, operation: string, input: Record<string, any> = {}) {
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(7283741)`;
    await actor(db,c, operation.startsWith('admin.'));
    if(operation==='admin.queue') await audit(db,c,'patient_platform.queue_viewed','patient_platform',c.sub);
    const id = input.id as string;
    switch(operation) {
      case 'notifications': return {data:await db.notificationLog.findMany({where:{userId:c.sub,templateKey:{startsWith:'patient.'}},orderBy:{createdAt:'desc'},take:50,select:{id:true,templateKey:true,payload:true,createdAt:true}})};
      case 'reports': return {data:await db.patientSocialReport.findMany({where:{reporterId:c.sub},orderBy:{createdAt:'desc'},take:50,select:{id:true,reason:true,status:true,resolution:true,createdAt:true}})};
      case 'profile': {
        const p = await db.patientSocialProfile.findUnique({where:{userId:c.sub}});
        return {profile:p ? {...p,userId:undefined}:null,consent_version:SOCIAL_CONSENT,terms:SOCIAL_TERMS};
      }
      case 'consent': {
        if (!['patient','clinician'].includes(c.role)) deny();
        if (input.consent && input.consent_version !== SOCIAL_CONSENT) deny('Please review the current community terms.');
        const existing = await db.patientSocialProfile.findUnique({where:{userId:c.sub}});
        if (existing?.suspended) deny('Contact support about this community suspension.');
        const p = await db.patientSocialProfile.upsert({where:{userId:c.sub},create:{userId:c.sub,alias:input.alias,consentVersion:input.consent?SOCIAL_CONSENT:null,peerEnabled:input.consent&&input.peer_enabled},update:{alias:input.alias,consentVersion:input.consent?SOCIAL_CONSENT:null,peerEnabled:input.consent&&input.peer_enabled}});
        if (p.peerEnabled) await profile(db,c.sub,true);
        if (!p.consentVersion) await db.healthSpaceMember.deleteMany({where:{userId:c.sub}});
        if (!p.peerEnabled) await db.peerConversation.updateMany({where:{OR:[{requesterId:c.sub},{recipientId:c.sub}],status:{in:['pending','accepted']}},data:{status:'closed'}});
        await invalidatePeers(db,c.sub);
        await audit(db,c,'patient_social.consent_updated','patient_social_profiles',c.sub);
        return {ok:true};
      }
      case 'spaces': {
        await profile(db,c.sub);
        const spaces = await db.healthSpace.findMany({where:{active:true},orderBy:{name:'asc'},include:{members:{where:{userId:c.sub},select:{userId:true}}}});
        return {data:spaces.map(s=>({id:s.id,name:s.name,description:s.description,joined:s.members.length>0}))};
      }
      case 'membership': {
        await profile(db,c.sub);
        if (!await db.healthSpace.findFirst({where:{id,active:true}})) throw notFound('Community not found');
        if(input.join) await db.healthSpaceMember.upsert({where:{spaceId_userId:{spaceId:id,userId:c.sub}},create:{spaceId:id,userId:c.sub},update:{}});
        else await db.healthSpaceMember.deleteMany({where:{spaceId:id,userId:c.sub}});
        if(!input.join) await invalidatePeers(db,c.sub);
        return {ok:true};
      }
      case 'posts': {
        await member(db,id,c.sub);
        const blocks = await db.patientSocialBlock.findMany({where:{OR:[{userId:c.sub},{targetId:c.sub}]}});
        const hidden = blocks.map(b=>b.userId===c.sub?b.targetId:b.userId);
        const rows = await db.healthSpacePost.findMany({where:{spaceId:id,authorId:{notIn:hidden},OR:[{status:'approved'},{authorId:c.sub}]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,...(input.cursor?{cursor:{id:input.cursor},skip:1}:{})});
        return {data:await Promise.all(rows.slice(0,50).map(async p=>({...await publicPost(db,p),mine:p.authorId===c.sub}))),next_cursor:rows.length>50?rows[49]!.id:null};
      }
      case 'post': {
        await member(db,id,c.sub); await rate(db,c,'post');
        if(input.parent_id) {
          const parent = await db.healthSpacePost.findFirst({where:{id:input.parent_id,spaceId:id,status:'approved'}});
          if(!parent || await blocked(db,c.sub,parent.authorId)) throw notFound('Reply target not found');
          if(parent.parentId) throw unprocessable('THREAD_DEPTH','Reply to the original discussion.');
        }
        const row = await db.healthSpacePost.create({data:{spaceId:id,authorId:c.sub,body:input.body,parentId:input.parent_id??null}});
        return {id:row.id,status:row.status};
      }
      case 'peers': {
        await profile(db,c.sub,true);
        const chats = await db.peerConversation.findMany({where:{OR:[{requesterId:c.sub},{recipientId:c.sub}]},orderBy:{updatedAt:'desc'},take:100});
        const data = [];
        for(const chat of chats) {
          const otherId=chat.requesterId===c.sub?chat.recipientId:chat.requesterId;
          const p=await db.patientSocialProfile.findUnique({where:{userId:otherId}});
          data.push({id:chat.id,status:chat.status,incoming:chat.recipientId===c.sub,alias:p?.alias??'Member'});
        }
        return {data};
      }
      case 'invite': {
        await profile(db,c.sub,true);
        const post=await db.healthSpacePost.findFirst({where:{id,status:'approved'}});
        if(!post || post.authorId===c.sub) throw notFound('Member not available');
        await member(db,post.spaceId,c.sub); await member(db,post.spaceId,post.authorId);
        await profile(db,post.authorId,true);
        if(await blocked(db,c.sub,post.authorId)) deny();
        const pairKey=[c.sub,post.authorId].sort().join(':');
        const old=await db.peerConversation.findUnique({where:{pairKey}});
        if(old) return {id:old.id,status:old.status}; // Declines cannot be bypassed with repeated invitations.
        const recent=await db.peerConversation.count({where:{requesterId:c.sub,createdAt:{gte:new Date(Date.now()-86400000)}}});
        if(recent>=10) throw unprocessable('RATE_LIMITED','You have reached today\'s invitation limit.');
        const row=await db.peerConversation.create({data:{pairKey,requesterId:c.sub,recipientId:post.authorId}});
        await notice(db,post.authorId,'patient.peer_invitation',row.id);
        return {id:row.id,status:row.status};
      }
      case 'peerDecision': {
        const chat=await peerAccess(db,c,id,false);
        if(chat.recipientId!==c.sub || chat.status!=='pending') deny();
        await db.peerConversation.update({where:{id},data:{status:input.accept?'accepted':'declined'}});
        await audit(db,c,'patient_social.peer_decision','peer_conversations',id);
        return {ok:true};
      }
      case 'messages': {
        await peerAccess(db,c,id);
        const rows=await db.peerMessage.findMany({where:{conversationId:id},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,...(input.cursor?{cursor:{id:input.cursor},skip:1}:{})});
        return {data:rows.slice(0,50).map(m=>({id:m.id,body:m.body,mine:m.senderId===c.sub,created_at:m.createdAt})),next_cursor:rows.length>50?rows[49]!.id:null};
      }
      case 'message': {
        const chat=await peerAccess(db,c,id);
        const old=await db.peerMessage.findUnique({where:{senderId_requestKey:{senderId:c.sub,requestKey:input.request_key}}});
        if(old) {if(old.conversationId!==id) deny(); return {id:old.id};}
        await rate(db,c,'message');
        const row=await db.peerMessage.create({data:{conversationId:id,senderId:c.sub,requestKey:input.request_key,body:input.body}});
        await db.peerConversation.update({where:{id},data:{updatedAt:new Date()}});
        const recipient=chat.requesterId===c.sub?chat.recipientId:chat.requesterId;
        // Transactional NOTIFY is delivered only after commit; no message body or alias travels on the bus.
        const event=JSON.stringify({event:'patient.message',entity:'peer_messages',id:row.id,careThreadId:id,audienceUserIds:[recipient,c.sub]});
        await db.$executeRaw`SELECT pg_notify('ahealth_events', ${event})`;
        await notice(db,recipient,'patient.peer_message',id);
        return {id:row.id};
      }
      case 'block': {
        const chat=await db.peerConversation.findUnique({where:{id}});
        if(!chat || ![chat.requesterId,chat.recipientId].includes(c.sub)) throw notFound('Conversation not found');
        const targetId=chat.requesterId===c.sub?chat.recipientId:chat.requesterId;
        await db.patientSocialBlock.upsert({where:{userId_targetId:{userId:c.sub,targetId}},create:{userId:c.sub,targetId},update:{}});
        await db.peerConversation.update({where:{id},data:{status:'blocked'}});
        await invalidatePeers(db,c.sub);
        await audit(db,c,'patient_social.block','peer_conversations',id);
        return {ok:true};
      }
      case 'report': {
        await profile(db,c.sub); await rate(db,c,'report');
        let snapshot='';
        if(input.kind==='post') {
          const p=await db.healthSpacePost.findUnique({where:{id}});
          if(!p || p.status!=='approved') throw notFound('Post not found');
          await member(db,p.spaceId,c.sub); snapshot=p.body;
        } else {
          const m=await db.peerMessage.findUnique({where:{id}});
          if(!m) throw notFound('Message not found');
          const chat=await db.peerConversation.findUnique({where:{id:m.conversationId}});
          if(!chat || ![chat.requesterId,chat.recipientId].includes(c.sub)) deny();
          snapshot=m.body; // Only the specifically reported message is disclosed.
        }
        const r=await db.patientSocialReport.create({data:{reporterId:c.sub,targetId:id,targetKind:input.kind,snapshot,reason:input.reason,urgent:input.urgent}});
        await audit(db,c,'patient_social.report','patient_social_reports',r.id);
        return {id:r.id,status:r.status};
      }
      case 'feedback': {
        if(c.role!=='patient') deny();
        return {data:await db.patientFeedback.findMany({where:{userId:c.sub},orderBy:{createdAt:'desc'},take:100,omit:{userId:true}})};
      }
      case 'feedbackCreate': {
        if(c.role!=='patient') deny(); await rate(db,c,'feedback');
        const row=await db.patientFeedback.create({data:{userId:c.sub,kind:input.kind,subject:input.subject,body:input.body,escalated:input.urgent,status:input.urgent?'escalated':'received',history:[{status:input.urgent?'escalated':'received',note:'Submitted',at:new Date().toISOString()}]}});
        await audit(db,c,'patient_feedback.created','patient_feedback',row.id);
        return {id:row.id};
      }
      case 'feedbackEscalate': {
        const row=await db.patientFeedback.findFirst({where:{id,userId:c.sub}});
        if(!row) throw notFound('Feedback not found');
        if(row.status==='resolved' || row.escalated) throw unprocessable('STATE_TRANSITION_INVALID','This feedback cannot be escalated again.');
        await db.patientFeedback.update({where:{id},data:{escalated:true,status:'escalated',history:[...(row.history as Prisma.JsonArray),{status:'escalated',note:'Escalated by reporter',at:new Date().toISOString()}]}});
        await audit(db,c,'patient_feedback.escalated','patient_feedback',id);
        return {ok:true};
      }
      case 'admin.queue': return {
        posts:await Promise.all((await db.healthSpacePost.findMany({where:{status:'pending'},orderBy:{createdAt:'asc'},take:100})).map(p=>publicPost(db,p))),
        reports:await db.patientSocialReport.findMany({where:{status:'open'},orderBy:[{urgent:'desc'},{createdAt:'asc'}],take:100,omit:{reporterId:true}}),
        feedback:await db.patientFeedback.findMany({where:{status:{not:'resolved'}},orderBy:[{escalated:'desc'},{createdAt:'asc'}],take:100,omit:{userId:true}}),
      };
      case 'admin.space': return db.healthSpace.create({data:{name:input.name,description:input.description}});
      case 'admin.moderate': {
        const p=await db.healthSpacePost.findUnique({where:{id}});
        if(!p) throw notFound('Post not found');
        if(input.status==='approved') {await member(db,p.spaceId,p.authorId);if(p.parentId && !await db.healthSpacePost.findFirst({where:{id:p.parentId,status:'approved',spaceId:p.spaceId}})) deny('The parent discussion must be approved.');}
        await db.healthSpacePost.update({where:{id},data:{status:input.status,reason:input.reason,reviewedBy:c.sub,reviewedAt:new Date()}});
        if(input.status!=='approved') await db.healthSpacePost.updateMany({where:{parentId:id},data:{status:'hidden'}});
        await audit(db,c,'patient_social.moderated','health_space_posts',id);
        await notice(db,p.authorId,'patient.community_review',id);
        return {ok:true};
      }
      case 'admin.resolveReport': {
        const r=await db.patientSocialReport.findUnique({where:{id}});
        if(!r || r.status!=='open') throw notFound('Open report not found');
        if(input.hide && r.targetKind==='post') {
          await db.healthSpacePost.update({where:{id:r.targetId},data:{status:'hidden',reason:input.resolution,reviewedBy:c.sub,reviewedAt:new Date()}});
          await db.healthSpacePost.updateMany({where:{parentId:r.targetId},data:{status:'hidden'}});
        }
        if(input.suspend) {
          const target=r.targetKind==='post'? (await db.healthSpacePost.findUnique({where:{id:r.targetId}}))?.authorId : (await db.peerMessage.findUnique({where:{id:r.targetId}}))?.senderId;
          if(target) {await db.patientSocialProfile.update({where:{userId:target},data:{suspended:true,peerEnabled:false}});await invalidatePeers(db,target);}
        }
        await db.patientSocialReport.update({where:{id},data:{status:'resolved',resolution:input.resolution}});
        await audit(db,c,'patient_social.report_resolved','patient_social_reports',id);
        await notice(db,r.reporterId,'patient.report_resolved',id);
        return {ok:true};
      }
      case 'admin.feedbackUpdate': {
        const row=await db.patientFeedback.findUnique({where:{id}});
        if(!row) throw notFound('Feedback not found');
        await db.patientFeedback.update({where:{id},data:{status:input.status,escalated:row.escalated||input.status==='escalated',history:[...(row.history as Prisma.JsonArray),{status:input.status,note:input.note,at:new Date().toISOString()}]}});
        await audit(db,c,'patient_feedback.updated','patient_feedback',id);
        await notice(db,row.userId,'patient.feedback_updated',id);
        return {ok:true};
      }
      default: throw notFound('Operation not found');
    }
  },{timeout:15000});
}
