#!/usr/bin/env bash
#
# Two bugs from fix-research.sh itself:
#
#   1. `binding.allowedGroupFields.includes(f)` — `f` is `string` (from the
#      zod-validated group_by array) but allowedGroupFields is now typed
#      AllowedGroupField[], and .includes() requires a matching element
#      type. Cast `f` at the one check site.
#
#   2. My v1 fix's regex for the "refuses a stranger..." test used `.` to
#      match the apostrophe in "else's", expecting one character — but the
#      source literally contains the six-character escape sequence \u2019
#      at that point, not a single character. The regex never matched, so
#      makeResearcher() was never inserted into that one test, leaving
#      `researcher` undefined there. Anchored this time on the test's
#      unique ethics_approval_ref value ('ETH-3') instead.
#
# Run from the repo root:
#   bash fix-research-v2.sh
#
set -euo pipefail

ROOT="$(pwd)"
QUERY="$ROOT/services/research/src/services/query.service.ts"
TEST="$ROOT/services/research/src/tests/research.test.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$QUERY" ] || { echo "services/research not set up."; exit 1; }

cp "$QUERY" "$QUERY.bak2"
cp "$TEST" "$TEST.bak2"

node - "$QUERY" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const old = "const invalidFields = input.query.group_by.filter((f) => !binding.allowedGroupFields.includes(f));";
const replacement = "const invalidFields = input.query.group_by.filter((f) => !binding.allowedGroupFields.includes(f as AllowedGroupField));";

if (s.includes(replacement)) {
  console.log('  query.service.ts already fixed');
} else if (!s.includes(old)) {
  console.error('  invalidFields anchor not found');
  process.exit(1);
} else {
  s = s.replace(old, replacement);
  fs.writeFileSync(p, s);
  console.log('  query.service.ts: includes() check now casts to AllowedGroupField');
}
NODE

node - "$TEST" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

// Unique to exactly one test: the ethics_approval_ref value used only in
// "refuses a stranger reading someone else's query".
const anchor = "await seedDatasets();\n    const dataset = await prisma.researchDataset.findUniqueOrThrow({ where: { name: CONSULTATION_VOLUMES.datasetName } });\n    const result = await queries.submitQuery(\n      researcher, { dataset_id: dataset.id, ethics_approval_ref: 'ETH-3'";

if (s.includes('const researcher = await makeResearcher();\n    await seedDatasets();\n    const dataset = await prisma.researchDataset.findUniqueOrThrow({ where: { name: CONSULTATION_VOLUMES.datasetName } });\n    const result = await queries.submitQuery(\n      researcher, { dataset_id: dataset.id, ethics_approval_ref: \'ETH-3\'')) {
  console.log('  research.test.ts already fixed');
} else if (!s.includes(anchor)) {
  console.error('  ETH-3 test anchor not found — cannot locate the exact test block');
  process.exit(1);
} else {
  s = s.replace(anchor, 'const researcher = await makeResearcher();\n    ' + anchor);
  fs.writeFileSync(p, s);
  console.log('  research.test.ts: makeResearcher() added to the stranger-reading test');
}
NODE

echo
echo "verify: no bare 'researcher' left undefined —"
grep -c "researcher," "$TEST"
grep -c "makeResearcher()" "$TEST"

echo
echo "Next:"
echo "  pnpm --filter @a-health/research exec tsc --noEmit"
echo "  pnpm --filter @a-health/research test"
