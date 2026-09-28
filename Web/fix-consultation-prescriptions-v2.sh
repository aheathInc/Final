#!/usr/bin/env bash
#
# Two real bugs from fix-consultation-prescriptions.sh:
#
#   1. The controller imports the service under `import * as consultations
#      from '../services/consultation.service.js'` (plural) — my patch called
#      `consultation.getPrescription(...)` (singular), a name that was never
#      imported. Fixed to use the alias that was already there.
#
#   2. consultation.service.ts's existing top-of-file import only pulled in
#      appendAudit/conflict/forbidden/notFound/recordChange from
#      @a-health/http — my patch used cursorArgs and toCursorPage without
#      adding them to that same import line.
#
# Run from the repo root:
#   bash fix-consultation-prescriptions-v2.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/consultation"
SERVICE_FILE="$SVC/src/services/consultation.service.ts"
CONTROLLER="$SVC/src/controllers/consultation.controller.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SERVICE_FILE" ] || { echo "services/consultation not set up."; exit 1; }

cp "$SERVICE_FILE" "$SERVICE_FILE.bak2"
cp "$CONTROLLER" "$CONTROLLER.bak2"

# ---------------------------------------------------------------------------
# 1. consultation.service.ts: add cursorArgs/toCursorPage to the existing import
# ---------------------------------------------------------------------------
node - "$SERVICE_FILE" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const old = "import { appendAudit, conflict, forbidden, notFound, recordChange } from '@a-health/http';";
const replacement = "import { appendAudit, conflict, cursorArgs, forbidden, notFound, recordChange, toCursorPage } from '@a-health/http';";

if (s.includes(replacement)) {
  console.log('  consultation.service.ts import already fixed');
} else if (!s.includes(old)) {
  console.error('  import line anchor not found');
  process.exit(1);
} else {
  s = s.replace(old, replacement);
  fs.writeFileSync(p, s);
  console.log('  consultation.service.ts: cursorArgs + toCursorPage added to the existing import');
}
NODE

# ---------------------------------------------------------------------------
# 2. controller: use the alias that was already there (`consultations`)
# ---------------------------------------------------------------------------
node - "$CONTROLLER" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const old = `export const getPrescription = handle((req) =>
  consultation.getPrescription(pathParam(req, 'prescription_id'), caller(req)));

export const listPatientPrescriptions = handle((req) =>
  consultation.listPatientPrescriptions(
    pathParam(req, 'patient_profile_id'), caller(req), listQuery.parse(req.query),
  ));`;

const replacement = `export const getPrescription = handle((req) =>
  consultations.getPrescription(pathParam(req, 'prescription_id'), caller(req)));

export const listPatientPrescriptions = handle((req) =>
  consultations.listPatientPrescriptions(
    pathParam(req, 'patient_profile_id'), caller(req), listQuery.parse(req.query),
  ));`;

if (s.includes(replacement)) {
  console.log('  consultation.controller.ts already fixed');
} else if (!s.includes(old)) {
  console.error('  controller anchor not found');
  process.exit(1);
} else {
  s = s.replace(old, replacement);
  fs.writeFileSync(p, s);
  console.log('  consultation.controller.ts: now calls consultations.* (matching the existing import alias)');
}
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/consultation exec tsc --noEmit"
echo "  pnpm --filter @a-health/consultation test"
