import { prisma, Prisma } from '@a-health/database';
import { appendAudit, badRequest, conflict, forbidden } from '@a-health/http';
import { z } from 'zod';
import { LEVELS, completedMonth, protectCells, reportFromReleases, validateTree, type Area, type ReleasePayload } from './regional-insights.policy.js';

type Caller = { sub: string; role: string };
export async function assertInsightAdmin(caller: Caller) {
  if (caller.role !== 'platform_admin') throw forbidden('ROLE_NOT_PERMITTED', 'Regional insights require platform administrator access.');
  const actor = await prisma.user.findUnique({ where: { id: caller.sub }, select: { role: true, status: true } });
  if (actor?.role !== 'platform_admin' || actor.status !== 'active') throw forbidden('ROLE_NOT_PERMITTED', 'Active platform administrator access is required.');
}
const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/);
export const importAreasSchema = z.object({
  source: z.string().trim().min(5).max(300),
  administrative_centroids_confirmed: z.literal(true),
  areas: z.array(z.object({
    code, name: z.string().trim().min(1).max(150), level: z.enum(LEVELS),
    parent_code: code.nullable(),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
  }).strict().refine(a => (a.latitude === null) === (a.longitude === null), 'Provide both centroid coordinates or neither.')).min(1).max(1000),
}).strict();
export async function importAreas(caller: Caller, input: z.infer<typeof importAreasSchema>) {
  await assertInsightAdmin(caller);
  const data = importAreasSchema.parse(input);
  if (data.areas.some(a=>a.code.startsWith('recorded-region:'))) throw badRequest('VALIDATION_FAILED','The recorded-region prefix is reserved for existing profile region codes.');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(26102601)`;
    const existing = await tx.reportingArea.findMany();
    const additions = data.areas.map(a => ({ code:a.code,name:a.name,level:a.level,parentCode:a.parent_code,latitude:a.latitude,longitude:a.longitude,source:data.source }));
    const combined = new Map(existing.map(a=>[a.code,a]));
    if (new Set(additions.map(a=>a.code)).size !== additions.length) throw badRequest('VALIDATION_FAILED','Duplicate area codes.');
    for (const a of additions) {
      const old = combined.get(a.code);
      if (old && ['name','level','parentCode','latitude','longitude'].some(k=>old[k as keyof typeof old] !== a[k as keyof typeof a])) {
        throw conflict('VERSION_CONFLICT','Published geography is append-only. Use a new code for a changed area.');
      }
      if (!old) combined.set(a.code, { ...a, createdAt:new Date() });
    }
    try { validateTree([...combined.values()]); } catch(e) { throw badRequest('VALIDATION_FAILED',(e as Error).message); }
    let added = 0;
    for (const level of LEVELS) for (const a of additions.filter(a=>a.level===level && !existing.some(e=>e.code===a.code))) {
      await tx.reportingArea.create({data:a}); added++;
    }
    await appendAudit({ actorUserId:caller.sub,action:'insights.geography_imported',entityType:'reporting_areas',metadata:{added,source:data.source} },tx);
    return { added };
  });
}
export async function listAreas() {
  // Geography contains no clinical information and supports patient address entry.
  return { data: await prisma.reportingArea.findMany({select:{code:true,name:true,level:true,parentCode:true,latitude:true,longitude:true},orderBy:[{level:'asc'},{name:'asc'}]}) };
}
export async function publishMonth(caller: Caller, period: string) {
  await assertInsightAdmin(caller);
  try { completedMonth(period); } catch(e) { throw badRequest('VALIDATION_FAILED',(e as Error).message); }
  const from = new Date(`${period}-01T00:00:00Z`), to = new Date(from);
  to.setUTCMonth(to.getUTCMonth()+1);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(26102602)`;
    const prior = await tx.regionalInsightRelease.findUnique({where:{period}});
    if (prior) return {period,publishedAt:prior.publishedAt.toISOString(),alreadyPublished:true};
    const areas: Area[] = await tx.reportingArea.findMany({select:{code:true,name:true,level:true,parentCode:true,latitude:true,longitude:true}});
    const recordedRegions = await tx.patientProfile.findMany({where:{regionCode:{not:null}},select:{regionCode:true},distinct:['regionCode']});
    for (const {regionCode} of recordedRegions) {
      if (regionCode && /^[A-Z0-9][A-Z0-9_.-]{0,19}$/.test(regionCode) && !areas.some(a=>a.level==='region'&&a.code===regionCode)) {
        // Preserve recorded region codes without inventing a country, name or centroid.
        areas.push({code:'recorded-region:'+regionCode,name:regionCode,level:'region',parentCode:null,latitude:null,longitude:null});
      }
    }
    const rows = await tx.$queryRaw<{ areaCode:string|null;conditionCode:string;cases:bigint;participants:bigint }[]>`
      SELECT COALESCE(p.reporting_area_code, legacy.code,
        CASE WHEN p.region_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,19}$' THEN 'recorded-region:' || p.region_code END) AS "areaCode", codes.code AS "conditionCode",
        COUNT(DISTINCT cn.id)::bigint AS cases, COUNT(DISTINCT p.id)::bigint AS participants
      FROM consultation_notes cn
      JOIN consultation_requests cr ON cr.id=cn.consultation_id
      JOIN patient_profiles p ON p.id=cr.patient_profile_id
      LEFT JOIN reporting_areas legacy ON legacy.code=p.region_code AND legacy.level='region'
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(cn.diagnosis_codes)='array' THEN cn.diagnosis_codes ELSE '[]'::jsonb END) AS codes(code)
      WHERE cn.signed_at >= ${from} AND cn.signed_at < ${to}
        AND codes.code ~ '^[A-Za-z0-9][A-Za-z0-9.\-]{1,39}$'
      GROUP BY 1,2
    `;
    const cells=protectCells(rows.map(r=>({...r,cases:Number(r.cases),participants:Number(r.participants)})));
    const mappings=await tx.researchCodeMapping.findMany({where:{domain:'condition',standardConcept:true,system:{in:['ICD10','ICD11']},sourceCode:{in:[...new Set(cells.map(c=>c.conditionCode))]}},select:{sourceCode:true,label:true}});
    const labels:Record<string,string>={};
    for (const c of cells) {
      const names=[...new Set(mappings.filter(m=>m.sourceCode===c.conditionCode).map(m=>m.label.trim()).filter(Boolean))];
      if(names.length===1)labels[c.conditionCode]=names[0];
    }
    const payload: ReleasePayload = {version:1,areas,cells,labels};
    const release = await tx.regionalInsightRelease.create({data:{period,payload:payload as unknown as Prisma.InputJsonValue,publishedBy:caller.sub}});
    await appendAudit({actorUserId:caller.sub,action:'insights.month_published',entityType:'regional_insight_releases',metadata:{period,source:'signed_consultation_notes',minimumParticipants:10}},tx);
    return {period,publishedAt:release.publishedAt.toISOString(),alreadyPublished:false};
  },{timeout:30000,isolationLevel:'RepeatableRead'}).catch(async (error:unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002','P2034'].includes(error.code)) {
      const prior = await prisma.regionalInsightRelease.findUnique({where:{period}});
      if (prior) return {period,publishedAt:prior.publishedAt.toISOString(),alreadyPublished:true};
    }
    throw error;
  });
}
export const reportQuery = z.object({
  from:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  to:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  area:code.optional(),level:z.enum(LEVELS).default('region'),condition:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.\-]{1,39}$/).optional(),
}).strict();
export async function getRegionalInsights(caller:Caller, query: z.input<typeof reportQuery>) {
  await assertInsightAdmin(caller);
  const filters = reportQuery.parse(query);
  if (filters.from && filters.to && filters.from > filters.to) throw badRequest('VALIDATION_FAILED','The start month must precede the end month.');
  const available = await prisma.regionalInsightRelease.findMany({select:{period:true,publishedAt:true},orderBy:{period:'desc'}});
  const to = filters.to ?? available[0]?.period;
  const from = filters.from ?? available[Math.min(11,available.length-1)]?.period;
  const releases = to ? await prisma.regionalInsightRelease.findMany({where:{period:{gte:from,lte:to}},orderBy:{period:'asc'}}) : [];
  try {
    return {...reportFromReleases(releases.map(r=>({...r,payload:r.payload as unknown as ReleasePayload})),filters),availablePeriods:available.map(r=>r.period)};
  } catch(e) { throw badRequest('VALIDATION_FAILED',(e as Error).message); }
}
