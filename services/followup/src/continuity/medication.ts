import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, unprocessable } from '@a-health/http';
import { patient, type Caller, type Meta } from './service.js';

type Report = { scheduledAt: Date; reportedAt: Date | null; reportedStatus: string; snoozeCount: number };
export function medicationStats(rows: Report[], now: Date) {
  const due = rows.filter(r => r.scheduledAt <= now);
  const taken = due.filter(r => r.reportedStatus === 'taken').length;
  const skipped = due.filter(r => r.reportedStatus === 'missed').length;
  const delayed = due.filter(r => r.reportedStatus === 'delayed').length;
  return { due: due.length, taken, skipped, delayed, unconfirmed: due.length - taken - skipped - delayed,
    reported_taken_percent: due.length ? Math.round(taken / due.length * 100) : null,
    // No clinical grace window is invented. This is the reported timestamp.
    taken_after_scheduled: due.filter(r => r.reportedStatus === 'taken' && r.reportedAt && r.reportedAt > r.scheduledAt).length,
    snoozed: due.filter(r => r.snoozeCount > 0).length };
}
export function estimatedSupply(baseline: number, units: number | null, takenSince: number) {
  return Math.max(0, Math.round((baseline - (units ?? 0) * takenSince) * 1000) / 1000);
}
export async function medicationAlarms(caller:Caller,now=new Date()) {
  const {rows}=await patient(undefined,caller);
  const doses=await prisma.adherenceLog.findMany({where:{patientProfileId:{in:rows.map(r=>r.id)},supersededAt:null,
    reportedStatus:{in:['unreported','delayed']},reminderPlan:{is:{status:'active'}},prescription:{status:{not:'discontinued'}},
    OR:[{scheduledAt:{gt:now,lte:new Date(now.getTime()+366*86400000)}},{snoozedUntil:{gt:now}}]},
    orderBy:[{scheduledAt:'asc'},{id:'asc'}],take:401,select:{id:true,scheduledAt:true,snoozedUntil:true}});
  const data=doses.slice(0,400).map(d=>({id:d.id,at:(d.snoozedUntil&&d.snoozedUntil>now?d.snoozedUntil:d.scheduledAt).toISOString()}));
  return {data,has_more:doses.length>400,coverage_end:data.length?data.reduce((a,b)=>a.at>b.at?a:b).at:null,as_of:now.toISOString()};
}
export async function medicationSummary(caller: Caller, input: { patient_profile_id?: string; days: number }, now = new Date()) {
  const { selected, rows: profiles } = await patient(input.patient_profile_id, caller);
  const from = new Date(now.getTime() - input.days * 86_400_000);
  const doses = await prisma.adherenceLog.findMany({ where: { patientProfileId: selected.id, supersededAt: null,
    scheduledAt: { gte: from, lte: now }, reminderPlan: { is: { status: 'active' } },
    prescription: { status: { not: 'discontinued' } } }, select: { scheduledAt: true, reportedAt: true, reportedStatus: true, snoozeCount: true } });
  const groups = new Map<string, Report[]>();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const row of doses) { const key = day.format(row.scheduledAt); groups.set(key, [...(groups.get(key) ?? []), row]); }
  const items = await prisma.prescriptionItem.findMany({ where: { prescription: { patientProfileId: selected.id, status: { not: 'discontinued' } } },
    include: { medicationSupplies: { where: { patientProfileId: selected.id } }, reminderPlan: true }, orderBy: { id: 'asc' }, take: 101 });
  const medicines = await Promise.all(items.slice(0,100).map(async item => {
    const stock = item.medicationSupplies[0];
    const taken = stock ? await prisma.adherenceLog.count({ where: { prescriptionItemId: item.id, patientProfileId: selected.id,
      reportedStatus: 'taken', supersededAt: null, reportedAt: { gte: stock.baselineAt } } }) : 0;
    const remaining = stock ? estimatedSupply(Number(stock.baselineQuantity), stock.unitsPerDose == null ? null : Number(stock.unitsPerDose), taken) : null;
    return { id: item.id, medication_name: item.medicationName, dosage: item.dosage, instructions: item.instructions,
      image_url: item.medicationImageUrl, education: item.medicationEducation, information_source: 'prescribing_clinician',
      schedule_status: item.reminderPlan?.status ?? 'timing_not_confirmed',
      supply: stock ? { version: stock.version, remaining, baseline_quantity: Number(stock.baselineQuantity),
        units_per_dose: stock.unitsPerDose == null ? null : Number(stock.unitsPerDose), unit_label: stock.unitLabel,
        low_stock_threshold: Number(stock.lowStockThreshold), low_stock: remaining! <= Number(stock.lowStockThreshold),
        baseline_at: stock.baselineAt.toISOString(), source: 'patient_reported_estimate' } : null };
  }));
  return { patient: { id: selected.id, full_name: selected.fullName }, profiles: profiles.map(p => ({id:p.id,full_name:p.fullName})),
    window: { from: from.toISOString(), to: now.toISOString(), days: input.days, timezone: 'Africa/Dar_es_Salaam' },
    summary: medicationStats(doses, now), trend: [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date, values])=>({date,...medicationStats(values,now)})),
    medicines, medicines_truncated: items.length > 100 };
}
export async function snoozeDose(id: string, caller: Caller, input: { base_version: number; minutes: number }, meta: Meta, now = new Date()) {
  return prisma.$transaction(async tx => {
    const found = await tx.adherenceLog.findUnique({where:{id},select:{prescriptionItemId:true}});
    if (!found) throw notFound('Dose not found.');
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`care-plan:${found.prescriptionItemId}`}, 0))`;
    const row = await tx.adherenceLog.findUniqueOrThrow({where:{id},include:{patient:true,reminderPlan:true,prescription:true}});
    if(caller.role !== 'patient' || (row.patient.userId!==caller.sub && row.patient.guardianUserId!==caller.sub)) throw forbidden('NOT_RESOURCE_OWNER','This dose is not yours.');
    if(row.supersededAt || row.reminderPlan?.status!=='active' || row.prescription.status==='discontinued') throw conflict('STATE_TRANSITION_INVALID','Reload the current medicine plan.');
    if(!['unreported','delayed'].includes(row.reportedStatus) || row.scheduledAt>now || now.getTime()-row.scheduledAt.getTime()>86_400_000) throw unprocessable('Only a due, unconfirmed dose from the last 24 hours can be snoozed.');
    const until=new Date(now.getTime()+input.minutes*60_000);
    const changed=await tx.adherenceLog.updateMany({where:{id,version:input.base_version,reportedStatus:{in:['unreported','delayed']},supersededAt:null},
      data:{snoozedUntil:until,snoozeCount:{increment:1},version:{increment:1}}});
    if(!changed.count) throw conflict('VERSION_CONFLICT','The dose changed. Reload it.');
    await appendAudit({actorUserId:caller.sub,action:'adherence.reminder_snoozed',entityType:'adherence_logs',entityId:id,
      metadata:{minutes:input.minutes,originalScheduledAt:row.scheduledAt.toISOString(),snoozedUntil:until.toISOString()},ipAddress:meta.ip,requestId:meta.requestId},tx);
    return {id,scheduled_at:row.scheduledAt.toISOString(),snoozed_until:until.toISOString(),reported_status:row.reportedStatus,version:input.base_version+1};
  });
}
export async function saveSupply(id:string,caller:Caller,input:{base_version:number;quantity:number;units_per_dose?:number;unit_label:string;low_stock_threshold:number},meta:Meta,now=new Date()) {
  return prisma.$transaction(async tx=>{
    const item=await tx.prescriptionItem.findUnique({where:{id},include:{prescription:true}});
    if(!item)throw notFound('Medicine not found.');
    const {selected}=await patient(item.prescription.patientProfileId,caller,tx);
    if(item.prescription.status==='discontinued')throw conflict('STATE_TRANSITION_INVALID','This prescription was discontinued.');
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`care-plan:${id}`}, 0))`;
    const existing=await tx.medicationSupply.findUnique({where:{patientProfileId_prescriptionItemId:{patientProfileId:selected.id,prescriptionItemId:id}}});
    if((existing?.version??0)!==input.base_version)throw conflict('VERSION_CONFLICT','Stock information changed. Reload it.');
    const data={baselineQuantity:input.quantity,unitsPerDose:input.units_per_dose??null,unitLabel:input.unit_label,lowStockThreshold:input.low_stock_threshold,baselineAt:now,updatedById:caller.sub};
    const saved=existing?await tx.medicationSupply.update({where:{id:existing.id},data:{...data,version:{increment:1}}}):await tx.medicationSupply.create({data:{...data,patientProfileId:selected.id,prescriptionItemId:id}});
    await appendAudit({actorUserId:caller.sub,action:'adherence.supply_reported',entityType:'medication_supplies',entityId:saved.id,metadata:{source:'patient_reported'},ipAddress:meta.ip,requestId:meta.requestId},tx);
    return {id:saved.id,version:saved.version,source:'patient_reported_estimate'};
  });
}
