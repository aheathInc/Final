'use strict';
// In-memory transaction/ORM simulation ONLY. This does NOT test PostgreSQL locks,
// Prisma generation, indexes, migrations, Express, JWT, or a real browser.
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { load } = require('./load-typescript.cjs');
const domain = load('services/consultation/src/front-desk/domain.ts');
const errors = load('packages/http/src/errors.ts');
const hash = load('packages/http/src/hash.ts');
const copy = (v) => structuredClone(v);
function equal(a, b) { return a instanceof Date && b instanceof Date ? +a === +b : a === b; }
function match(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'OR') return value.some((q) => match(row, q));
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every((q) => match(row, q));
    if (key === 'patientProfileId_requestKey') return match(row, value);
    const actual = row[key];
    if (value === null || value instanceof Date || typeof value !== 'object') return equal(actual, value);
    if ('in' in value && !value.in.includes(actual)) return false;
    if ('not' in value && equal(actual, value.not)) return false;
    if ('lt' in value && !(actual < value.lt)) return false;
    if ('lte' in value && !(actual <= value.lte)) return false;
    if ('gt' in value && !(actual > value.gt)) return false;
    if ('gte' in value && !(actual >= value.gte)) return false;
    if (Object.keys(value).some((k) => ['in','not','lt','lte','gt','gte'].includes(k))) return true;
    return match(actual, value);
  });
}
function harness() {
  let state = { user: [], patientProfile: [], clinicianProfile: [], facility: [], department: [],
    frontDeskVisit: [], careThread: [], consultationRequest: [], consultationNote: [], audits: [], changes: [] };
  const locks = []; let failAudit = false; let tail = Promise.resolve();
  const now = () => new Date();
  const add = (model, input) => {
    const row = { id: randomUUID(), createdAt: now(), updatedAt: now(), version: 1, ...input }; state[model].push(row); return row;
  };
  function hydrate(model, raw) {
    if (!raw) return null; const row = copy(raw);
    const find = (name,id) => state[name].find((r) => r.id === id) ?? null;
    if (model === 'clinicianProfile') {
      row.user = copy(find('user',row.userId)); row.facility = copy(find('facility',row.facilityId)); row.department = copy(find('department',row.departmentId));
    }
    if (model === 'frontDeskVisit') {
      row.patient = copy(find('patientProfile',row.patientProfileId)); row.facility = copy(find('facility',row.facilityId)); row.department = copy(find('department',row.departmentId));
      row.requestedClinician = hydrate('clinicianProfile', find('clinicianProfile',row.requestedClinicianId));
      row.assignedClinician = hydrate('clinicianProfile', find('clinicianProfile',row.assignedClinicianId));
      row.consultation = copy(find('consultationRequest',row.consultationId));
    }
    return row;
  }
  const tx = { $queryRaw: async (parts, ...values) => { locks.push({ sql: parts.join('?'), values }); return []; } };
  const prisma = { $transaction: async (fn) => {
    const before = tail; let release; tail = new Promise((resolve) => { release = resolve; }); await before;
    const snapshot = copy(state);
    try { return await fn(tx); } catch (error) { state = snapshot; throw error; } finally { release(); }
  } };
  for (const model of Object.keys(state).filter((m) => !['audits','changes'].includes(m))) {
    const methods = {
      findUnique: async ({ where }) => hydrate(model, state[model].find((r) => match(hydrate(model,r), where))),
      findUniqueOrThrow: async (q) => { const result = await methods.findUnique(q); if (!result) throw new Error('Missing fixture ' + model); return result; },
      findFirst: async (q) => (await methods.findMany({ ...q, take: 1 }))[0] ?? null,
      findMany: async ({ where = {}, orderBy = [], take = 1e9, cursor, skip = 0 } = {}) => {
        const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
        const rows = state[model].map((r) => hydrate(model,r)).filter((r) => match(r,where));
        rows.sort((a,b) => { for (const order of orders) for (const [k,d] of Object.entries(order)) { if (equal(a[k],b[k])) continue; return (a[k] < b[k] ? -1 : 1) * (d === 'desc' ? -1 : 1); } return 0; });
        const start = cursor ? Math.max(0,rows.findIndex((r) => r.id === cursor.id)) + skip : 0;
        return rows.slice(start,start+take);
      },
      count: async ({ where } = {}) => (await methods.findMany({ where })).length,
      groupBy: async ({ by, where }) => {
        const groups = new Map();
        for (const row of await methods.findMany({ where })) {
          const key=JSON.stringify(by.map((f) => row[f]));
          if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(by.map((f) => [f,row[f]])), _count: { _all: 0 } });
          groups.get(key)._count._all += 1;
        }
        return [...groups.values()];
      },
      create: async ({ data }) => {
        const defaults = model === 'frontDeskVisit' ? {
          ticketNumber: state.frontDeskVisit.length + 1, requestedClinicianId: null, assignedClinicianId: null, consultationId: null,
          status: 'preregistered', checkedInAt: null, administrativeAt: null, administrativeBy: null,
          paymentCheck: 'pending', insuranceCheck: 'pending', paymentReference: null, insuranceReference: null,
          triageStatus: 'pending', triageBy: null, triageAt: null, readyAt: null, calledAt: null,
          startedAt: null, completedAt: null, cancelledAt: null,
        } : model === 'consultationRequest' ? { referredFromId: null, appointmentId: null, voiceNoteKey: null,
          clientCreatedAt: null, completedAt: null, requestLat: null, requestLng: null, escalationCount: 0 } : {};
        return hydrate(model,add(model,{ ...defaults,...data }));
      },
      update: async ({ where, data }) => {
        const row = state[model].find((r) => match(hydrate(model,r),where));
        if (!row) throw new Error('Missing row ' + model);
        for (const [key,value] of Object.entries(data)) {
          if (value === undefined) continue;
          row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] ?? 0) + value.increment
            : value && typeof value === 'object' && 'decrement' in value ? (row[key] ?? 0) - value.decrement : copy(value);
        }
        row.updatedAt=now(); return hydrate(model,row);
      },
      updateMany: async ({ where, data }) => {
        const rows = state[model].filter((r) => match(hydrate(model,r),where));
        for (const row of rows) await methods.update({ where: { id: row.id }, data });
        return { count: rows.length };
      },
    };
    tx[model] = methods; prisma[model] = methods;
  }
  const http = { ...errors,...hash,
    appendAudit: async (input, transaction) => {
      if (input.action.startsWith('frontdesk.')) assert.equal(transaction,tx,'New frontdesk audit MUST share the transaction');
      if (failAudit) throw new Error('Synthetic audit failure'); state.audits.push(copy(input));
    },
    recordChange: async (transaction, input) => { assert.equal(transaction,tx); state.changes.push(copy(input)); },
  };
  const service = load('services/consultation/src/front-desk/service.ts', { '@a-health/database': { prisma }, '@a-health/http': http,
    '../config/env.js': { env: { SLA_ROUTINE_SECONDS: 7200 } }, './domain.js': domain });
  const consultations = load('services/consultation/src/services/consultation.service.ts', {
    '@a-health/database': { prisma }, '@a-health/http': http, '../config/env.js': { env: {} },
    '../engine/triage.js': {}, './ruleset.service.js': {}, '../engine/matching.js': {}, '../events.js': { publishConsultationEvent: async () => {} },
  });
  function user(role,name) { return add('user',{ role,status: 'active',fullName:name }); }
  const pUser=user('patient','Synthetic Patient A'); const pBUser=user('patient','Synthetic Patient B');
  const patient=add('patientProfile',{ userId:pUser.id,guardianUserId:null,fullName:pUser.fullName });
  const patientB=add('patientProfile',{ userId:pBUser.id,guardianUserId:null,fullName:pBUser.fullName });
  const adminUser=user('platform_admin','Synthetic Admin');
  const f=add('facility',{ name:'Synthetic Facility A',isActive:true,digitalDeskEnabled:true,deskPaymentRequired:false,deskInsuranceRequired:false });
  const fB=add('facility',{ name:'Synthetic Facility B',isActive:true,digitalDeskEnabled:true,deskPaymentRequired:false,deskInsuranceRequired:false });
  const d=add('department',{ facilityId:f.id,name:'Kinywa na meno',isActive:true,navigationAliases:['jino','meno','tooth','teeth'] });
  const dB=add('department',{ facilityId:fB.id,name:'Other department',isActive:true,navigationAliases:[] });
  function doctor(facilityId,departmentId) {
    const u=user('clinician','Synthetic Clinician'); const c=add('clinicianProfile',{ userId:u.id,facilityId,departmentId,
      verificationStatus:'verified',isAvailable:true,availableUntil:null,currentLoad:0,specialty:'other' });
    return {sub:u.id,role:'clinician',cpid:c.id};
  }
  const a={sub:pUser.id,role:'patient',ppid:patient.id}; const b={sub:pBUser.id,role:'patient',ppid:patientB.id};
  const adminCaller={sub:adminUser.id,role:'platform_admin'}; const doc=doctor(f.id,d.id); const doc2=doctor(f.id,d.id); const outsider=doctor(fB.id,dB.id);
  const input=(extra={}) => ({ request_key:randomUUID(),facility_id:f.id,department_id:d.id,purpose:'TEST DATA ONLY — dental service navigation',share_with_department:true,urgent_help_requested:false,...extra });
  async function waiting(caller=a, extra={}) {
    let v=await service.createVisit(caller,input(extra),{});
    v=await service.checkInVisit(caller,v.id,v.version,{});
    v=await service.administrativeReview(adminCaller,v.id,{base_version:v.version,registration_confirmed:true,payment_check:'not_required',insurance_check:'not_required'},{});
    return service.clinicalReview(doc,v.id,{base_version:v.version,decision:'cleared'},{});
  }
  return {service,consultations,domain,prisma,tx,get state(){return state;},locks,add,input,a,b,admin:adminCaller,doc,doc2,outsider,f,d,fB,dB,patient,patientB,waiting,
    failAudit(value){failAudit=value;},raw(model,id){return state[model].find((r)=>r.id===id);} };
}
module.exports = { harness, domain };
