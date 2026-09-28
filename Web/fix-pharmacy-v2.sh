#!/usr/bin/env bash
#
# Two more fixes surfaced after fix-pharmacy.sh:
#
#   1. tsc: two test call sites still passed `undefined` for pharmacy_id after
#      the first fix made it a required parameter. Both tests are checking a
#      rejection that happens before pharmacy_id is ever used (role check,
#      then code lookup), so a throwaway UUID satisfies the type without
#      changing what either test verifies.
#
#   2. Runtime FK violations during cleanup: the care-thread deletion loop was
#      placed BEFORE the prescription cleanup loop. Deleting a CareThread
#      cascades to its Prescription, but DispensingRecord references that
#      Prescription with Restrict — so the cascade was blocked, CareThread
#      never actually got deleted, and every deletion after it (down to the
#      clinician) failed in a chain from that one ordering mistake. The
#      correct order is: dispensing records/items and prescriptions first,
#      then care threads (which frees the consultations), then clinicians.
#
# Run from the repo root:
#   bash fix-pharmacy-v2.sh
#
set -euo pipefail

ROOT="$(pwd)"
TEST="$ROOT/services/pharmacy/src/tests/pharmacy.test.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$TEST" ] || { echo "services/pharmacy tests not found."; exit 1; }

cp "$TEST" "$TEST.bak2"

node - "$TEST" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
let changes = 0;

// --- 1. the two undefined-pharmacy_id call sites --------------------------
const old1 = "() => dispensing.verifyDispenseCode(issued.code, undefined, { sub: randomUUID(), role: 'patient' }),";
const new1 = "() => dispensing.verifyDispenseCode(issued.code, randomUUID(), { sub: randomUUID(), role: 'patient' }),";
if (s.includes(old1)) { s = s.replace(old1, new1); changes++; }

const old2 = "() => dispensing.verifyDispenseCode('000000', undefined, { sub: pharmacist.id, role: 'pharmacist' }),";
const new2 = "() => dispensing.verifyDispenseCode('000000', randomUUID(), { sub: pharmacist.id, role: 'pharmacist' }),";
if (s.includes(old2)) { s = s.replace(old2, new2); changes++; }

console.log(`  test call sites fixed: ${changes}/2`);

// --- 2. reorder cleanup: threadIds loop must come AFTER prescriptionIds ---
const misplacedBlock =
  "after(async () => {\n" +
  "  for (const id of threadIds) {\n" +
  "    // Cascades to consultation_requests, which is what frees clinicians\n" +
  "    // held by the Restrict FK on assigned_clinician_id below.\n" +
  "    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);\n" +
  "  }\n" +
  "  for (const id of prescriptionIds) {";

if (s.includes(misplacedBlock)) {
  // Step 1: strip the loop out of its current (too-early) position.
  s = s.replace(
    misplacedBlock,
    "after(async () => {\n  for (const id of prescriptionIds) {",
  );

  // Step 2: find the end of the (now-relocated) prescriptionIds loop and
  // insert the careThread loop right after it, before pharmacyIds cleanup.
  const afterPrescriptionsAnchor = "  for (const id of pharmacyIds) {";
  if (!s.includes(afterPrescriptionsAnchor)) {
    console.error('  pharmacyIds anchor not found; cannot reposition careThread cleanup');
    process.exit(1);
  }
  const threadCleanup =
    "  // Deleted only now: Prescription and DispensingRecord/DispenseCode rows\n" +
    "  // are gone at this point, so the cascade from CareThread to\n" +
    "  // ConsultationRequest is no longer blocked, and this is what frees the\n" +
    "  // clinician held by the Restrict FK below.\n" +
    "  for (const id of threadIds) {\n" +
    "    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);\n" +
    "  }\n";
  s = s.replace(afterPrescriptionsAnchor, threadCleanup + afterPrescriptionsAnchor);

  console.log('  cleanup order: care threads now deleted after prescriptions, before pharmacies/clinicians');
} else if (s.includes('for (const id of threadIds) {') && s.indexOf('for (const id of threadIds)') > s.indexOf('for (const id of prescriptionIds)')) {
  console.log('  cleanup order already correct');
} else {
  console.error('  could not find the misplaced cleanup block in its expected form');
  process.exit(1);
}

fs.writeFileSync(p, s);

// --- verify -----------------------------------------------------------------
const onDisk = fs.readFileSync(p, 'utf8');
if (onDisk.includes('verifyDispenseCode(issued.code, undefined,') || onDisk.includes("verifyDispenseCode('000000', undefined,")) {
  console.error('  VERIFY FAILED: an undefined pharmacy_id call site remains');
  process.exit(1);
}
const threadPos = onDisk.indexOf('for (const id of threadIds)');
const prescPos = onDisk.indexOf('for (const id of prescriptionIds)');
if (threadPos < prescPos) {
  console.error('  VERIFY FAILED: threadIds cleanup still runs before prescriptionIds cleanup');
  process.exit(1);
}
console.log('  verified on disk: both fixes present and correctly ordered');
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/pharmacy exec tsc --noEmit"
echo "  pnpm --filter @a-health/pharmacy test"
