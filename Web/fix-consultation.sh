#!/usr/bin/env bash
#
# Two fixes:
#
#   1. CareThread.activeFollowUpCycleId exists in the contract and in the
#      consultation service, but was never added to the Prisma model. Schema
#      and contract had drifted; tsc caught it.
#
#   2. Triage routed a six-year-old with a rash to dermatology, because the
#      symptom hint beat the age rule. That is backwards: a paediatrician is
#      the right first contact for a child whatever the presenting system, and
#      paediatric sub-specialists are scarce enough here that the direct route
#      strands the patient. Pregnancy overrides even that, because adolescent
#      pregnancy is common enough to matter and needs obstetric care.
#
# Run from the repo root:
#   bash fix-consultation.sh
#
set -euo pipefail

ROOT="$(pwd)"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"
TRIAGE="$ROOT/services/consultation/src/engine/triage.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SCHEMA" ] || { echo "Schema not found."; exit 1; }
[ -f "$TRIAGE" ] || { echo "Triage engine not found."; exit 1; }

cp "$SCHEMA" "$SCHEMA.bak"
cp "$TRIAGE" "$TRIAGE.bak"

node - "$SCHEMA" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('activeFollowUpCycleId')) {
  console.log('  schema already has activeFollowUpCycleId');
} else {
  const re = /(\n(\s*)openConsultationCount\s+Int[^\n]*)/;
  if (!re.test(s)) { console.error('  CareThread anchor not found'); process.exit(1); }
  s = s.replace(re, (_m, line, indent) =>
    `${line}\n\n${indent}/// The follow-up cycle currently running on this thread, if any. Kept on\n` +
    `${indent}/// the thread so the timeline view does not have to query for it.\n` +
    `${indent}activeFollowUpCycleId String? @map("active_follow_up_cycle_id") @db.Uuid`);
  fs.writeFileSync(p, s);
  console.log('  schema: activeFollowUpCycleId added to CareThread');
}
NODE

node - "$TRIAGE" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const oldAgeLine = "    if (age < 16 && specialty === 'general_practice') specialty = 'paediatrics';\n";
const oldPregnancy = `  if (input.isPregnant && specialty === 'general_practice') {
    specialty = 'obstetrics_gynaecology';
  }
`;

const newBlock = `  // Age takes precedence over the symptom hint. A paediatrician is the right
  // first contact for a child whatever the presenting system; onward referral
  // to a sub-specialty is a clinical decision, not a triage one. Routing a
  // six-year-old with a rash straight to dermatology strands them, because
  // paediatric dermatologists are scarce.
  if (age !== null && age !== undefined && age < 16) {
    specialty = 'paediatrics';
  }

  // Pregnancy overrides even that. Adolescent pregnancy is common enough to
  // matter, and it needs obstetric care rather than paediatric care.
  if (input.isPregnant) {
    specialty = 'obstetrics_gynaecology';
  }
`;

if (!s.includes(oldAgeLine)) { console.error('  age-line anchor not found'); process.exit(1); }
if (!s.includes(oldPregnancy)) { console.error('  pregnancy anchor not found'); process.exit(1); }

s = s.replace(oldAgeLine, '');
s = s.replace(oldPregnancy, newBlock);
fs.writeFileSync(p, s);
console.log('  triage: specialty precedence corrected');
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/database exec prisma format"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name care_thread_active_cycle"
echo "  pnpm --filter @a-health/consultation exec tsc --noEmit"
echo "  pnpm --filter @a-health/consultation test"
