import { randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { appendAudit,forbidden,notFound,conflict,unprocessable } from '@a-health/http';
import { requireTzs } from './policy.js';
export interface BillCaller {sub?:string;role?:string}
export function serialiseBill(b:{id:string;reference:string;title:string;amount:unknown;currency:string;purpose:string;status:string;consultationId:string|null;createdAt:Date;expiresAt:Date;paidAt:Date|null}){
 return {id:b.id,reference:b.reference,title:b.title,amount:Number(b.amount),currency:b.currency,purpose:b.purpose,status:b.status,
 consultation_id:b.consultationId,created_at:b.createdAt.toISOString(),expires_at:b.expiresAt.toISOString(),paid_at:b.paidAt?.toISOString()??null};
}
export async function issueBill(caller:BillCaller,input:{consultation_id:string;amount:number;currency:string;title:string}){
 if(!caller.sub||!['platform_admin','clinician'].includes(caller.role??''))throw forbidden('ROLE_NOT_PERMITTED','Only authorized billing staff may issue a bill.');
 let amount:number;try{amount=requireTzs(input.amount,input.currency);}catch{throw unprocessable('A positive whole TZS amount is required.');}
 return prisma.$transaction(async tx=>{
   const actor=await tx.user.findUnique({where:{id:caller.sub},include:{clinicianProfile:true}});
   if(!actor||actor.status!=='active'||actor.role!==caller.role)throw forbidden('ROLE_NOT_PERMITTED','Billing permission unavailable.');
   const consultation=await tx.consultationRequest.findUnique({where:{id:input.consultation_id},include:{patient:true}});
   if(!consultation)throw notFound('Consultation not found.');
   if(actor.role==='clinician'&&(actor.clinicianProfile?.verificationStatus!=='verified'||consultation.assignedClinicianId!==actor.clinicianProfile.id))throw forbidden('NOT_RESOURCE_OWNER','Only the assigned clinician may issue this consultation bill.');
   const payer=consultation.patient.userId??consultation.patient.guardianUserId;
   if(!payer)throw unprocessable('A bill requires a registered payer.');
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bill:${consultation.id}`},0))`;
   const existing=await tx.careBill.findUnique({where:{consultationId:consultation.id}});
   if(existing){if(Number(existing.amount)!==amount||existing.title!==input.title)throw conflict('DUPLICATE_RESOURCE','A bill already exists for this consultation.');return serialiseBill(existing);}
   const b=await tx.careBill.create({data:{reference:`AHP-${randomUUID().replace(/-/g,'').slice(0,24).toUpperCase()}`,payerUserId:payer,issuedById:caller.sub!,patientProfileId:consultation.patientProfileId,
     consultationId:consultation.id,title:input.title,amount,currency:'TZS',purpose:'consultation_fee',expiresAt:new Date(Date.now()+7*86400_000)}});
   await appendAudit({actorUserId:caller.sub,action:'payment.bill_issued',entityType:'care_bills',entityId:b.id,metadata:{consultationId:consultation.id,currency:'TZS',amount}},tx);
   return serialiseBill(b);
 });
}
export async function listBills(caller:BillCaller){
 if(!caller.sub||!['patient','platform_admin','clinician'].includes(caller.role??''))throw forbidden('ROLE_NOT_PERMITTED','Not permitted.');
 const rows=await prisma.careBill.findMany({where:caller.role==='platform_admin'?{}:caller.role==='clinician'?{issuedById:caller.sub}:{payerUserId:caller.sub},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100});
 return {data:rows.map(serialiseBill),meta:{next_cursor:null,limit:100}};
}
