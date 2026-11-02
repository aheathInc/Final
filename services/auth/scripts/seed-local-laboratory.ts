import { prisma } from '@a-health/database';
import { assertLocalAuthSeedEnvironment } from '../src/config/security.js';

const facilityId = '88000000-0000-4000-8000-000000000001';
const threadId = '88000000-0000-4000-8000-000000000002';
const orderIds = ['88000000-0000-4000-8000-000000000003', '88000000-0000-4000-8000-000000000004'];
async function main() {
  assertLocalAuthSeedEnvironment(process.env);
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV !== 'development' || url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/ahealth_dev' || (url.searchParams.get('schema') ?? 'public') !== 'public') throw new Error('Local laboratory fixture requires the development database on 127.0.0.1:55432');
  const [identity] = await prisma.$queryRaw<Array<{ db: string; port: number; address: string }>>`SELECT current_database() AS db, inet_server_port() AS port, inet_server_addr()::text AS address`;
  const address = identity?.address?.toLowerCase().replace(/^::ffff:/, '').replace(/\/\d+$/, '');
  if (identity?.db !== 'ahealth_dev' || identity.port !== 55432 || address !== '127.0.0.1') throw new Error('Local database identity mismatch');
  const emails = ['platform-admin@dev.local', 'lab-tech@dev.local', 'doctor@dev.local', 'patient@dev.local'];
  const accounts = await prisma.user.findMany({ where: { email: { in: emails } }, include: { clinicianProfile: true, patientProfile: true } });
  if (accounts.length !== 4 || accounts.some(u => !u.fullName?.startsWith('AHP Local Test:') || u.status !== 'active')) throw new Error('Create the marked local demo accounts first');
  const admin = accounts.find(u => u.email === emails[0] && u.role === 'platform_admin')!;
  const lab = accounts.find(u => u.email === emails[1] && u.role === 'lab_technician')!;
  const clinician = accounts.find(u => u.email === emails[2] && u.role === 'clinician')?.clinicianProfile;
  const patient = accounts.find(u => u.email === emails[3] && u.role === 'patient')?.patientProfile;
  if (!admin || !lab || !clinician || !patient) throw new Error('Expected demo role profiles were not found');
  await prisma.$transaction(async tx => {
    const existing = await tx.facility.findUnique({ where: { id: facilityId } });
    if (existing && existing.name !== 'AHP Local Test: Laboratory') throw new Error('Fixture facility ID is already in use');
    await tx.facility.upsert({ where: { id: facilityId }, create: { id: facilityId, name: 'AHP Local Test: Laboratory', type: 'laboratory', regionCode: 'DAR' }, update: {} });
    await tx.laboratoryMembership.upsert({ where: { userId_facilityId: { userId: lab.id, facilityId } },
      create: { userId: lab.id, facilityId, assignedByUserId: admin.id }, update: {} });
    const thread = await tx.careThread.findUnique({ where: { id: threadId } });
    if (thread && (thread.patientProfileId !== patient.id || thread.primaryClinicianId !== clinician.id)) throw new Error('Fixture care thread is already in use');
    await tx.careThread.upsert({ where: { id: threadId }, create: { id: threadId, patientProfileId: patient.id, primaryClinicianId: clinician.id }, update: {} });
    for (const [index, id] of orderIds.entries()) {
      const previous = await tx.investigationOrder.findUnique({ where: { id } });
      if (previous && (previous.careThreadId !== threadId || previous.facilityId !== facilityId)) throw new Error('Fixture order ID is already in use');
      await tx.investigationOrder.upsert({ where: { id }, create: {
        id, careThreadId: threadId, patientProfileId: patient.id, orderedById: clinician.id, facilityId,
        investigationCode: `DEMO-LAB-${index + 1}`, investigationType: 'laboratory',
        clinicalNotes: 'Synthetic demonstration order. No real sample or clinical decision.',
      }, update: {} });
    }
  });
  console.log('Local lab technician assigned to AHP Local Test: Laboratory.');
  console.log('Two synthetic demonstration orders are available; existing order states were preserved.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
