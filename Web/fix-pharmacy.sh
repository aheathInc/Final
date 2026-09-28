#!/usr/bin/env bash
#
# Four fixes surfaced by tsc and by the FK cleanup at the end of the test run:
#
#   1-3. DISPENSE_CODE_INVALID / DISPENSE_CODE_EXPIRED were used in the
#        pharmacy service but never added to packages/http's ErrorCode type,
#        even though they were already in the CONTRACT's error catalogue
#        since restore-full-contract.sh — a drift between contract and code
#        that tsc caught. Adding the full set of contract error codes that
#        were still missing, not just these two, so the same gap doesn't
#        resurface for diagnostics/quality/research next.
#
#   4. dispensing.service.ts tried to satisfy Prisma's create() with
#      `pharmacyId: pharmacyId ?? row.pharmacyId ?? undefined` — Prisma
#      accepts a field being absent, not present-and-undefined. Since
#      DispensingRecord.pharmacyId is required and redemption always happens
#      at a physical counter, pharmacy_id is made a required argument instead
#      of worked around.
#
#   5. The test's cleanup never deleted the CareThread/ConsultationRequest
#      created inside makePrescription(), so clinicianProfile.delete() hit the
#      Restrict FK on consultation_requests.assigned_clinician_id. Deleting
#      the care thread first cascades to its consultations, which is what
#      frees the clinician.
#
# Run from the repo root:
#   bash fix-pharmacy.sh
#
set -euo pipefail

ROOT="$(pwd)"
ERRORS="$ROOT/packages/http/src/errors.ts"
DISPENSING="$ROOT/services/pharmacy/src/services/dispensing.service.ts"
TYPES="$ROOT/services/pharmacy/src/types/pharmacy.types.ts"
CONTROLLER="$ROOT/services/pharmacy/src/controllers/pharmacy.controller.ts"
TEST="$ROOT/services/pharmacy/src/tests/pharmacy.test.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ERRORS" ] || { echo "packages/http/src/errors.ts missing."; exit 1; }
[ -f "$DISPENSING" ] || { echo "services/pharmacy not set up."; exit 1; }

for f in "$ERRORS" "$DISPENSING" "$TYPES" "$CONTROLLER" "$TEST"; do
  cp "$f" "$f.bak"
done

# ---------------------------------------------------------------------------
# 1-3. ErrorCode: add every contract error code still missing from the type
# ---------------------------------------------------------------------------
node - "$ERRORS" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const needed = [
  'CONSENT_REQUIRED', 'DEVICE_REVOKED', 'DISPENSE_CODE_INVALID', 'DISPENSE_CODE_EXPIRED',
  'RESULT_ALREADY_ACKNOWLEDGED', 'ETHICS_APPROVAL_REQUIRED', 'AGGREGATE_TOO_SMALL',
  'FACILITY_NOT_INTEGRATED', 'ALREADY_RATED',
];
const missing = needed.filter((code) => !s.includes(`'${code}'`));

if (missing.length === 0) {
  console.log('  ErrorCode already has all contract codes');
} else {
  const anchor = "  | 'DUPLICATE_RESOURCE'";
  if (!s.includes(anchor)) { console.error('  ErrorCode anchor not found'); process.exit(1); }
  const lines = missing.map((c) => `  | '${c}'`).join('\n');
  s = s.replace(anchor, `${lines}\n${anchor}`);
  fs.writeFileSync(p, s);
  const onDisk = fs.readFileSync(p, 'utf8');
  const stillMissing = missing.filter((c) => !onDisk.includes(`'${c}'`));
  if (stillMissing.length > 0) {
    console.error('  VERIFY FAILED, still missing:', stillMissing.join(', '));
    process.exit(1);
  }
  console.log(`  ErrorCode: added ${missing.join(', ')}`);
}
NODE

# ---------------------------------------------------------------------------
# 4. dispensing.service.ts: pharmacy_id required at verify, not optional
# ---------------------------------------------------------------------------
node - "$DISPENSING" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('export async function verifyDispenseCode(code: string, pharmacyId: string, caller: Caller)')) {
  console.log('  dispensing.service.ts already fixed');
} else {
  const oldSig = 'export async function verifyDispenseCode(code: string, pharmacyId: string | undefined, caller: Caller) {';
  const newSig =
    '// Required, not optional: redemption always happens at a physical counter,\n' +
    '// and a code that could be redeemed with no pharmacy on record would leave\n' +
    '// the dispensing tied to nothing.\n' +
    'export async function verifyDispenseCode(code: string, pharmacyId: string, caller: Caller) {';
  if (!s.includes(oldSig)) { console.error('  verifyDispenseCode signature anchor not found'); process.exit(1); }
  s = s.replace(oldSig, newSig);

  const oldBurn =
    '  const burned = await prisma.dispenseCode.updateMany({\n' +
    '    where: { id: row.id, redeemedAt: null },\n' +
    '    data: { redeemedAt: new Date(), pharmacyId: pharmacyId ?? null },\n' +
    '  });';
  const newBurn =
    '  const burned = await prisma.dispenseCode.updateMany({\n' +
    '    where: { id: row.id, redeemedAt: null },\n' +
    '    data: { redeemedAt: new Date(), pharmacyId },\n' +
    '  });';
  if (!s.includes(oldBurn)) { console.error('  burn-code anchor not found'); process.exit(1); }
  s = s.replace(oldBurn, newBurn);

  const oldCreate =
    '  const dispensing = await prisma.dispensingRecord.create({\n' +
    '    data: {\n' +
    '      prescriptionId: prescription.id,\n' +
    '      pharmacyId: pharmacyId ?? row.pharmacyId ?? undefined,\n' +
    '      pharmacistUserId: caller.sub,\n' +
    '      status: \'pending\',\n' +
    '    },\n' +
    '  });';
  const newCreate =
    '  const dispensing = await prisma.dispensingRecord.create({\n' +
    '    data: {\n' +
    '      prescriptionId: prescription.id,\n' +
    '      pharmacyId,\n' +
    '      pharmacistUserId: caller.sub,\n' +
    '      status: \'pending\',\n' +
    '    },\n' +
    '  });';
  if (!s.includes(oldCreate)) { console.error('  dispensingRecord.create anchor not found'); process.exit(1); }
  s = s.replace(oldCreate, newCreate);

  fs.writeFileSync(p, s);
  console.log('  dispensing.service.ts: pharmacy_id is now required at verify');
}
NODE

# ---------------------------------------------------------------------------
# types + controller: pharmacy_id required in the zod schema and its call site
# ---------------------------------------------------------------------------
node - "$TYPES" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
const old = '  pharmacy_id: z.string().uuid().optional(),';
if (!s.includes(old)) {
  console.log('  pharmacy.types.ts already fixed or anchor not found');
} else {
  s = s.replace(old, '  pharmacy_id: z.string().uuid(),');
  fs.writeFileSync(p, s);
  console.log('  pharmacy.types.ts: pharmacy_id required');
}
NODE

node - "$CONTROLLER" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
const old = 'return dispensing.verifyDispenseCode(input.code, input.pharmacy_id, caller(req));';
if (!s.includes(old)) {
  console.log('  pharmacy.controller.ts already fine (types now match)');
} else {
  console.log('  pharmacy.controller.ts call site unchanged (types now align with the required field)');
}
NODE

# ---------------------------------------------------------------------------
# 5. tests: track and delete the care thread before deleting the clinician
# ---------------------------------------------------------------------------
node - "$TEST" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('threadIds.push')) {
  console.log('  test cleanup already fixed');
} else {
  // Track thread ids alongside prescriptions.
  s = s.replace(
    'const prescriptionIds: string[] = [];',
    'const prescriptionIds: string[] = [];\nconst threadIds: string[] = [];',
  );

  // makePrescription(): push the thread id once it is created.
  s = s.replace(
    "  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });",
    "  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });\n  threadIds.push(thread.id);",
  );

  // Delete threads (cascades to their consultations) before clinicians, so
  // the Restrict FK on assigned_clinician_id no longer blocks the delete.
  const oldAfter =
    'after(async () => {\n' +
    '  for (const id of prescriptionIds) {';
  const newAfter =
    'after(async () => {\n' +
    '  for (const id of threadIds) {\n' +
    '    // Cascades to consultation_requests, which is what frees clinicians\n' +
    '    // held by the Restrict FK on assigned_clinician_id below.\n' +
    '    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);\n' +
    '  }\n' +
    '  for (const id of prescriptionIds) {';
  if (!s.includes(oldAfter)) { console.error('  test after() anchor not found'); process.exit(1); }
  s = s.replace(oldAfter, newAfter);

  fs.writeFileSync(p, s);
  console.log('  pharmacy.test.ts: care threads now deleted before clinicians');
}
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/pharmacy exec tsc --noEmit"
echo "  pnpm --filter @a-health/pharmacy test"
