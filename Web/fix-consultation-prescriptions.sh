#!/usr/bin/env bash
#
# Adds the two prescription read endpoints to services/consultation —
# GET /prescriptions/{id} and GET /patient-profiles/{id}/prescriptions.
# Prescription writing already exists (created inside completeConsultation);
# this was the read half of the same domain, confirmed absent from every
# installer script on disk during the post-devices/prevention gap check.
#
# Run from the repo root:
#   bash fix-consultation-prescriptions.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/consultation"
SERVICE_FILE="$SVC/src/services/consultation.service.ts"
CONTROLLER="$SVC/src/controllers/consultation.controller.ts"
ROUTES="$SVC/src/routes/consultation.routes.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SERVICE_FILE" ] || { echo "services/consultation not set up."; exit 1; }

for f in "$SERVICE_FILE" "$CONTROLLER" "$ROUTES"; do cp "$f" "$f.bak"; done

# ---------------------------------------------------------------------------
# 1. Service functions — appended at the end of consultation.service.ts
# ---------------------------------------------------------------------------
node - "$SERVICE_FILE" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('export async function getPrescription')) {
  console.log('  consultation.service.ts already has the prescription reads');
} else {
  s = s.trimEnd() + '\n\n' + String.raw`
function serialisePrescription(p: {
  id: string; careThreadId: string; consultationId: string; patientProfileId: string;
  prescribedById: string; status: string; createdAt: Date; version: number;
  items: { id: string; medicationName: string; dosage: string; frequencyPerDay: number; durationDays: number; instructions: string | null }[];
}) {
  return {
    id: p.id,
    care_thread_id: p.careThreadId,
    consultation_id: p.consultationId,
    patient_profile_id: p.patientProfileId,
    prescribed_by_id: p.prescribedById,
    status: p.status,
    items: p.items.map((i) => ({
      id: i.id,
      medication_name: i.medicationName,
      dosage: i.dosage,
      frequency_per_day: i.frequencyPerDay,
      duration_days: i.durationDays,
      instructions: i.instructions,
    })),
    created_at: p.createdAt.toISOString(),
    version: p.version,
  };
}

async function assertPrescriptionVisible(
  prescription: { patientProfileId: string; prescribedById: string },
  caller: Caller,
): Promise<void> {
  if (caller.role === 'platform_admin') return;
  if (caller.cpid && prescription.prescribedById === caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: prescription.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This prescription is not yours');
}

/** The read half of prescriptions — writing already happens inside completeConsultation(); this was the missing counterpart. */
export async function getPrescription(prescriptionId: string, caller: Caller) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId }, include: { items: true },
  });
  if (!prescription) throw notFound('Prescription not found');
  await assertPrescriptionVisible(prescription, caller);
  return serialisePrescription(prescription);
}

export async function listPatientPrescriptions(
  patientProfileId: string, caller: Caller, query: { cursor?: string; limit: number },
) {
  if (caller.role !== 'platform_admin' && !caller.cpid) {
    const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
    if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view this patient\\u2019s prescriptions');
  }
  const rows = await prisma.prescription.findMany({
    where: { patientProfileId },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialisePrescription);
}
`;
  fs.writeFileSync(p, s);
  console.log('  consultation.service.ts: getPrescription + listPatientPrescriptions added');
}
NODE

# ---------------------------------------------------------------------------
# 2. Controller — appended
# ---------------------------------------------------------------------------
node - "$CONTROLLER" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('export const getPrescription')) {
  console.log('  consultation.controller.ts already has the prescription controllers');
} else {
  s = s.trimEnd() + '\n\n' + String.raw`
export const getPrescription = handle((req) =>
  consultation.getPrescription(pathParam(req, 'prescription_id'), caller(req)));

export const listPatientPrescriptions = handle((req) =>
  consultation.listPatientPrescriptions(
    pathParam(req, 'patient_profile_id'), caller(req), listQuery.parse(req.query),
  ));
`;
  fs.writeFileSync(p, s);
  console.log('  consultation.controller.ts: getPrescription + listPatientPrescriptions added');
}
NODE

# ---------------------------------------------------------------------------
# 3. Routes — appended
# ---------------------------------------------------------------------------
node - "$ROUTES" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes("'/prescriptions/:prescription_id'")) {
  console.log('  consultation.routes.ts already has the prescription routes');
} else {
  s = s.trimEnd() + '\n' + String.raw`
consultationRouter.get('/prescriptions/:prescription_id', requireAuth, c.getPrescription);
consultationRouter.get('/patient-profiles/:patient_profile_id/prescriptions', requireAuth, c.listPatientPrescriptions);
` + '\n';
  fs.writeFileSync(p, s);
  console.log('  consultation.routes.ts: 2 routes added');
}
NODE

# ---------------------------------------------------------------------------
# 4. Tests — a small additional test file, kept separate from the existing
#    engine.test.ts so this patch never risks touching passing tests.
# ---------------------------------------------------------------------------
TEST="$SVC/src/tests/prescriptions.test.ts"
if [ ! -f "$TEST" ]; then
  cat > "$TEST" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as consultation from '../services/consultation.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const users: string[] = [];
const clinicians: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const prescriptionIds: string[] = [];

after(async () => {
  for (const id of prescriptionIds) {
    await prisma.adherenceLog.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescription.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.consultationRequest.deleteMany({ where: { careThreadId: id } }).catch(() => undefined);
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
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

async function makePrescription() {
  const patientUser = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Rx Test' },
  });
  users.push(patientUser.id);
  const profile = await prisma.patientProfile.create({ data: { userId: patientUser.id, fullName: 'Rx Test' } });

  const clinicianUser = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Rx Clinician' },
  });
  users.push(clinicianUser.id);
  const clinician = await prisma.clinicianProfile.create({
    data: { userId: clinicianUser.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(clinician.id);

  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  const consultationRow = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId: profile.id, assignedClinicianId: clinician.id,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
      status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
    },
  });
  consultationIds.push(consultationRow.id);

  const prescription = await prisma.prescription.create({
    data: {
      careThreadId: thread.id, consultationId: consultationRow.id, patientProfileId: profile.id,
      prescribedById: clinician.id,
      items: { create: [{ medicationName: 'Amoxicillin', dosage: '500mg', frequencyPerDay: 2, durationDays: 5 }] },
    },
  });
  prescriptionIds.push(prescription.id);

  return { patientUser, profile, clinician, prescription };
}

describe('prescription reads', () => {
  it('lets the owning patient read their own prescription', async () => {
    const { patientUser, profile, prescription } = await makePrescription();
    const result = await consultation.getPrescription(prescription.id, { sub: patientUser.id, role: 'patient', ppid: profile.id });
    assert.equal(result.id, prescription.id);
    assert.equal(result.items.length, 1);
  });

  it('lets the prescribing clinician read it', async () => {
    const { clinician, prescription } = await makePrescription();
    const result = await consultation.getPrescription(prescription.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id });
    assert.equal(result.id, prescription.id);
  });

  it('refuses a stranger', async () => {
    const { prescription } = await makePrescription();
    await assert.rejects(
      () => consultation.getPrescription(prescription.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('lists a patient\u2019s prescriptions', async () => {
    const { patientUser, profile } = await makePrescription();
    const result = await consultation.listPatientPrescriptions(profile.id, { sub: patientUser.id, role: 'patient', ppid: profile.id }, { limit: 25 });
    assert.equal(result.data.length, 1);
  });
});
TS
  echo "  prescriptions.test.ts written (4 tests)"
else
  echo "  prescriptions.test.ts already exists"
fi

echo
echo "Next:"
echo "  pnpm --filter @a-health/consultation exec tsc --noEmit"
echo "  pnpm --filter @a-health/consultation test"
