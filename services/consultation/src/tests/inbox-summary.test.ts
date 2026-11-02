// Query/serialization regression; Prisma methods are stubbed, no database I/O.
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@a-health/database';
import { listCareThreads } from '../services/careThread.service.js';

const originalProfiles = prisma.patientProfile.findMany;
const originalThreads = prisma.careThread.findMany;
afterEach(() => { prisma.patientProfile.findMany = originalProfiles; prisma.careThread.findMany = originalThreads; });
it('inbox summaries preserve patient ownership and count only incoming unread messages', async () => {
  let query: any;
  prisma.patientProfile.findMany = (async () => [{ id: 'synthetic-owned-profile' }]) as any;
  prisma.careThread.findMany = (async (input: any) => {
    query = input;
    return [{ id: 'synthetic-thread', patientProfileId: 'synthetic-owned-profile', primaryClinicianId: null,
      status: 'open', reasonSummary: 'Synthetic care', latestConsultationId: null, openConsultationCount: 0,
      activeFollowUpCycleId: null, outcome: null, openedAt: new Date('2026-10-28'), closedAt: null,
      version: 1, updatedAt: new Date('2026-10-28'), primaryClinician: null, patient: { fullName: 'Synthetic Patient' },
      messages: [{ body: 'x'.repeat(200), attachmentType: null, createdAt: new Date('2026-10-28'), senderUserId: 'synthetic-doctor' }],
      _count: { messages: 2 } }];
  }) as any;
  const result = await listCareThreads({ sub: 'synthetic-patient', role: 'patient' }, { limit: 25 });
  assert.deepEqual(query.where.patientProfileId, { in: ['synthetic-owned-profile'] });
  assert.deepEqual(query.include._count.select.messages.where, { senderUserId: { not: 'synthetic-patient' }, readAt: null });
  assert.equal(query.include.messages.take, 1);
  const row = result.data[0] as any;
  assert.equal(row.unread_count, 2);
  assert.equal(row.clinician_name, null);
  assert.equal(row.last_message.body.length, 180);
  assert.equal(row.last_message.sender_user_id, 'synthetic-doctor');
  assert.equal(result.meta.next_cursor, null);
});
