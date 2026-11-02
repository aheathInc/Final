import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {prisma} from '@a-health/database';
import {assertIsolatedLocalTestTarget,verifyLocalTestIdentity} from '@a-health/database/test-safety';
import {createPostgresEventBus} from '@a-health/http';
import {platformAction,SOCIAL_CONSENT} from '../services/patientPlatform.service.js';
import {listPharmacies,searchMedication} from '../../../pharmacy/src/services/pharmacy.service.js';
import * as education from '../../../education/src/services/education.service.js';
import * as messaging from '../../../messaging/src/services/message.service.js';
const target=assertIsolatedLocalTestTarget(process.env);
type Caller={sub:string;role:string};
const act=async(c:Caller,op:string,input:Record<string,unknown>={})=>await platformAction(c,op,input) as any;
let admin:Caller,a:Caller,b:Caller,outsider:Caller,minor:Caller,doctor:Caller;
async function user(role='patient',birth='1990-01-01'):Promise<Caller>{const u=await prisma.user.create({data:{phoneNumber:`+2557${randomInt(10000000,99999999)}`,role:role as never,status:'active'}});if(role==='patient')await prisma.patientProfile.create({data:{userId:u.id,fullName:'Synthetic platform test',dateOfBirth:new Date(birth)}});if(role==='clinician')await prisma.clinicianProfile.create({data:{userId:u.id,licenseNumber:randomUUID(),verificationStatus:'verified',specialty:'general_practice'}});return{sub:u.id,role};}
const consent=(c:Caller,peer=true)=>act(c,'consent',{alias:'Test member',consent:true,consent_version:SOCIAL_CONSENT,peer_enabled:peer});
async function space(){const s=await act(admin,'admin.space',{name:'Test community',description:'Synthetic health community'});await act(a,'membership',{id:s.id,join:true});await act(b,'membership',{id:s.id,join:true});return s;}
async function approved(s:any,c=b){const p=await act(c,'post',{id:s.id,body:'Synthetic discussion'});await act(admin,'admin.moderate',{id:p.id,status:'approved',reason:'Test review'});return p;}
before(async()=>{await verifyLocalTestIdentity(prisma,target);admin=await user('platform_admin');a=await user();b=await user();outsider=await user();minor=await user('patient','2015-01-01');doctor=await user('clinician');await consent(a);await consent(b);await consent(outsider);});
after(async()=>{await prisma.$disconnect();});
it('requires current consent, adulthood and active account; rejects forged admin role',async()=>{
 await assert.rejects(consent(minor),/adult/);await consent(minor,false);
 const unknown=await user();await assert.rejects(act(unknown,'spaces'),/consent/);
 await assert.rejects(act({...a,role:'platform_admin'},'admin.queue'));
 await prisma.user.update({where:{id:outsider.sub},data:{status:'suspended'}});await assert.rejects(act(outsider,'spaces'));await prisma.user.update({where:{id:outsider.sub},data:{status:'active'}});
});
it('keeps pending posts private, requires membership and confines replies to the same approved space',async()=>{
 const s=await space();const post=await act(a,'post',{id:s.id,body:'Pending private submission'});
 assert.equal((await act(b,'posts',{id:s.id})).data.length,0);assert.equal((await act(a,'posts',{id:s.id})).data[0].status,'pending');
 await assert.rejects(act(outsider,'posts',{id:s.id}));await assert.rejects(act(b,'post',{id:s.id,body:'Premature reply',parent_id:post.id}));
 await act(admin,'admin.moderate',{id:post.id,status:'approved',reason:'Test review'});const visible=(await act(b,'posts',{id:s.id})).data[0];assert.equal(visible.authorId,undefined);assert.equal(visible.author_alias,'Test member');
 const other=await space();await assert.rejects(act(b,'post',{id:other.id,body:'Wrong space',parent_id:post.id}));
});
it('requires a shared community, both opt-ins and recipient acceptance before peer messages',async()=>{
 const s=await space(),p=await approved(s);await assert.rejects(act(outsider,'invite',{id:p.id}));
 const chat=await act(a,'invite',{id:p.id});await assert.rejects(act(a,'message',{id:chat.id,body:'No consent',request_key:randomUUID()}));
 await assert.rejects(act(a,'peerDecision',{id:chat.id,accept:true}));await act(b,'peerDecision',{id:chat.id,accept:true});
 const key=randomUUID();const sent=await act(a,'message',{id:chat.id,body:'Private test message',request_key:key});const retry=await act(a,'message',{id:chat.id,body:'Ignored retry body',request_key:key});assert.equal(sent.id,retry.id);
 assert.equal((await act(b,'messages',{id:chat.id})).data.length,1);await assert.rejects(act(outsider,'messages',{id:chat.id}));await assert.rejects(act(admin,'messages',{id:chat.id}));
 const report=await act(b,'report',{id:sent.id,kind:'message',reason:'Synthetic moderation test',urgent:true});const q=await act(admin,'admin.queue');const r=q.reports.find((r:any)=>r.id===report.id);assert.equal(r.snapshot,'Private test message');assert.equal(r.reporterId,undefined);
 const bus=createPostgresEventBus(process.env.DATABASE_URL!);let resolve!:(e:any)=>void;const event=new Promise<any>(r=>resolve=r);await bus.subscribe(e=>{if(e.entity==='peer_messages'&&e.careThreadId===chat.id)resolve(e);});await act(a,'message',{id:chat.id,body:'Realtime test',request_key:randomUUID()});const notice=await Promise.race([event,new Promise((_,reject)=>setTimeout(()=>reject(Error('No realtime event')),3000))]);assert.equal((notice as any).data,undefined);assert.deepEqual(new Set((notice as any).audienceUserIds),new Set([a.sub,b.sub]));await bus.close();
 await act(b,'block',{id:chat.id});await assert.rejects(act(a,'messages',{id:chat.id}));await assert.rejects(act(a,'message',{id:chat.id,body:'Retry after block',request_key:key}));await assert.rejects(act(a,'invite',{id:p.id}));
});
it('withdrawal closes chats and removes memberships; rejoining does not bypass a prior decline',async()=>{
 const c=await user(),d=await user();await consent(c);await consent(d);const s=await act(admin,'admin.space',{name:'Consent test',description:'Synthetic'});for(const u of[c,d])await act(u,'membership',{id:s.id,join:true});const p=await approved(s,d);const chat=await act(c,'invite',{id:p.id});await act(d,'peerDecision',{id:chat.id,accept:false});assert.equal((await act(c,'invite',{id:p.id})).status,'declined');await act(c,'consent',{alias:'Withdrawn member',consent:false,peer_enabled:false});await assert.rejects(act(c,'posts',{id:s.id}));assert.equal(await prisma.healthSpaceMember.count({where:{userId:c.sub}}),0);
});
it('hiding a reported post hides replies; suspension prevents further participation',async()=>{
 const c=await user();await consent(c);const s=await space();await act(c,'membership',{id:s.id,join:true});const p=await approved(s,c);const reply=await act(a,'post',{id:s.id,body:'Synthetic reply',parent_id:p.id});await act(admin,'admin.moderate',{id:reply.id,status:'approved',reason:'Test review'});const r=await act(b,'report',{id:p.id,kind:'post',reason:'Test report',urgent:false});await act(admin,'admin.resolveReport',{id:r.id,resolution:'Test removal',hide:true,suspend:true});assert.equal((await prisma.healthSpacePost.findUniqueOrThrow({where:{id:reply.id}})).status,'hidden');await assert.rejects(act(c,'spaces'));
});
it('owns feedback history and records escalation and patient-visible review responses',async()=>{
 const t=await act(a,'feedbackCreate',{kind:'complaint',subject:'Synthetic delayed response',body:'Test only',urgent:false});assert.equal((await act(b,'feedback')).data.length,0);await assert.rejects(act(b,'feedbackEscalate',{id:t.id}));await act(a,'feedbackEscalate',{id:t.id});await assert.rejects(act(a,'feedbackEscalate',{id:t.id}));await act(admin,'admin.feedbackUpdate',{id:t.id,status:'resolved',note:'Synthetic resolution'});const own=(await act(a,'feedback')).data.find((r:any)=>r.id===t.id);assert.equal(own.history.length,3);assert.equal(own.history[2].note,'Synthetic resolution');assert.equal(own.userId,undefined);
});
it('filters distance before pagination and treats stale or inconsistent stock as unknown',async()=>{
 const far=await prisma.pharmacy.create({data:{name:'AAA Far',licenseNumber:randomUUID(),isVerified:true,isActive:true,lat:0,lng:0}}),near=await prisma.pharmacy.create({data:{name:'ZZZ Near',licenseNumber:randomUUID(),isVerified:true,isActive:true,lat:-6.8,lng:39.2}});
 const nearby=await listPharmacies({lat:-6.8,lng:39.2,radius_km:5,limit:1});assert.equal((nearby.data[0] as any).id,near.id);
 const stock=await prisma.pharmacyStock.create({data:{pharmacyId:near.id,medicationName:'Synthetic medicine',stockStatus:'in_stock',quantityOnHand:10,lastReportedAt:new Date(Date.now()-48*3600000)}});
 let found=await searchMedication({medication_name:'Synthetic medicine',lat:-6.8,lng:39.2});assert.equal(found.data[0]!.fulfillment_status,'unknown');assert.equal(found.data[0]!.quantity_on_hand,null);
 await prisma.pharmacyStock.update({where:{id:stock.id},data:{lastReportedAt:new Date()}});found=await searchMedication({medication_name:'Synthetic medicine',required_quantity:12});assert.equal(found.data[0]!.fulfillment_status,'partially_available');
 await prisma.pharmacyStock.update({where:{id:stock.id},data:{stockStatus:'out_of_stock',quantityOnHand:0}});found=await searchMedication({medication_name:'Synthetic medicine'});assert.equal(found.data[0]!.fulfillment_status,'unavailable');
 await prisma.pharmacy.update({where:{id:near.id},data:{isVerified:false}});assert.equal((await searchMedication({medication_name:'Synthetic medicine'})).data.length,0);assert.ok(far.id);
});
it('searches only published education and requires a verified clinician to publish structured disease guides',async()=>{
 await education.createTopic(admin,{slug:'platform-test',name:'Synthetic topic',category:'prevention'},{});
 await education.createArticle(admin,{topic_slug:'platform-test',slug:'synthetic-disease',title:'Synthetic disease',summary:'Test only',language:'sw',disease_guide:{causes:'Test',symptoms:'Test',prevention:'Test',diagnosis:'Test',treatment:'Test',warning_signs:'Test'},sources:[{title:'Test source',url:'https://example.org/education'}]},{});
 assert.equal((await education.listArticles({q:'Synthetic disease',limit:10})).data.length,0);await assert.rejects(education.publishArticle('synthetic-disease','sw',admin,{}));await education.publishArticle('synthetic-disease','sw',doctor,{});const results=await education.listArticles({q:'synthetic disease',limit:10});assert.equal(results.data.length,1);assert.equal(((results.data[0] as any).disease_guide as any).warning_signs,'Test');assert.equal((await education.listArticles({q:'no match',limit:10})).data.length,0);
});
it('care chat requires participant consent and rejects unrelated and suspended accounts',async()=>{
 const patient=await prisma.patientProfile.findUniqueOrThrow({where:{userId:a.sub}});const clinician=await prisma.clinicianProfile.findUniqueOrThrow({where:{userId:doctor.sub}});const thread=await prisma.careThread.create({data:{patientProfileId:patient.id,primaryClinicianId:clinician.id}});const bus={publish:async()=>{},subscribe:async()=>{},close:async()=>{}};
 await assert.rejects(messaging.createMessage(thread.id,a,{body:'Before consent'},bus,{}));await assert.rejects(messaging.chatConsent(thread.id,doctor,true));await messaging.chatConsent(thread.id,a,true);await messaging.createMessage(thread.id,doctor,{body:'Consented care message'},bus,{});await assert.rejects(messaging.listMessages(thread.id,outsider,{limit:10}));await assert.rejects(messaging.listMessages(thread.id,admin,{limit:10}));await prisma.user.update({where:{id:doctor.sub},data:{status:'suspended'}});await assert.rejects(messaging.listMessages(thread.id,doctor,{limit:10}));await prisma.user.update({where:{id:doctor.sub},data:{status:'active'}});await messaging.chatConsent(thread.id,a,false);await assert.rejects(messaging.createMessage(thread.id,doctor,{body:'After withdrawal'},bus,{}));assert.equal((await messaging.listMessages(thread.id,a,{limit:10})).data.length,1);
});

it('revokes peer access when the last shared membership is removed and scopes notifications',async()=>{
 const c=await user(),d=await user();await consent(c);await consent(d);const group=await act(admin,'admin.space',{name:'Shared membership test',description:'Synthetic'});for(const u of[c,d])await act(u,'membership',{id:group.id,join:true});const post=await approved(group,d);const chat=await act(c,'invite',{id:post.id});await act(d,'peerDecision',{id:chat.id,accept:true});await act(c,'message',{id:chat.id,body:'Before leaving',request_key:randomUUID()});const updates=await act(d,'notifications');assert.ok(updates.data.some((n:any)=>n.templateKey==='patient.peer_message'));assert.equal(updates.data[0].userId,undefined);await act(d,'membership',{id:group.id,join:false});await assert.rejects(act(c,'messages',{id:chat.id}),/shared/);
});
