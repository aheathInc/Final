const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
const dbUrl = new URL(env.DATABASE_URL);
assert.equal(dbUrl.hostname, '127.0.0.1'); assert.equal(dbUrl.port, '55432'); assert.equal(dbUrl.pathname, '/ahealth_dev');
const { PrismaClient } = createRequire(path.join(root, 'packages/database/package.json'))('@prisma/client');
const bcrypt = createRequire(path.join(root, 'services/auth/package.json'))('bcrypt');
const jwt = createRequire(path.join(root, 'packages/http/package.json'))('jsonwebtoken');
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const sign = claims => jwt.sign({ ...claims, status: 'active', jti: randomUUID() }, env.JWT_SECRET, { issuer: env.JWT_ISSUER || 'a-health', audience: env.JWT_AUDIENCE || 'a-health-api', expiresIn: 3600 });
async function api(route, body, token) {
  const res = await fetch('http://127.0.0.1:4005' + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json(); assert.ok(res.ok, `${route}: ${res.status} ${json.error?.message}`); return json;
}
(async () => {
  const suffix = Date.now(), phone = () => 'TEST-' + randomUUID().replaceAll('-', '').slice(0, 12);
  const facility = await prisma.facility.create({ data: { name: 'AHP Local Test: Consultation Modes Hospital', type: 'hospital' } });
  const user = await prisma.user.create({ data: { fullName: 'AHP Local Test: Modes Patient', phoneNumber: phone(), role: 'patient', status: 'active' } });
  const patient = await prisma.patientProfile.create({ data: { userId: user.id, fullName: user.fullName } });
  const staff = await prisma.user.create({ data: { fullName: 'AHP Local Test: Modes Doctor', email: `modes-${suffix}@dev.local`, passwordHash: await bcrypt.hash(env.AHP_LOCAL_TEST_PASSWORD, 12), phoneNumber: phone(), role: 'clinician', status: 'active' } });
  const clinician = await prisma.clinicianProfile.create({ data: { userId: staff.id, facilityId: facility.id, licenseNumber: `MODE-${suffix}`, specialty: 'general_practice', verificationStatus: 'verified', languagesSpoken: ['sw'] } });
  const patientToken = sign({ sub: user.id, role: 'patient', ppid: patient.id });
  const doctorToken = sign({ sub: staff.id, role: 'clinician', cpid: clinician.id, vst: 'verified', amr: 'password' });
  const consultations = {};
  for (const modality of ['in_person', 'video', 'voice', 'chat']) {
    const hospital = modality === 'in_person';
    const c = await api('/consultations', { channel: 'app', consultation_mode: hospital ? 'hospital' : 'remote', modality, clinician_id: clinician.id,
      ...(hospital ? { facility_id: facility.id } : {}), symptom_text: 'SYNTHETIC ONLY — consultation modes acceptance' }, patientToken);
    for (let i = 0; i < 30 && !await prisma.consultationOffer.count({ where: { consultationId: c.id } }); i++) await new Promise(r => setTimeout(r, 200));
    const accepted = await api(`/consultations/${c.id}/accept`, {}, doctorToken);
    consultations[modality] = c.id;
    assert.equal((await prisma.careBill.count({ where: { consultationId: c.id } })), hospital ? 0 : 1);
    console.log(`${modality}: request and acceptance passed`);
  }
  fs.mkdirSync(path.join(root, '.local'), { recursive: true });
  fs.writeFileSync(path.join(root, '.local/consultation-live.json'), JSON.stringify({ facilityId: facility.id, patientId: patient.id, userId: user.id, doctorId: clinician.id, doctorUserId: staff.id, email: staff.email, consultations }));
})().finally(() => prisma.$disconnect()).catch(e => { console.error(e.message); process.exitCode = 1; });
