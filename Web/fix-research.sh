#!/usr/bin/env bash
#
# Two real bugs from the first research test run:
#
#   1. `group_by as never` broke Prisma's own compile-time validation of
#      groupBy's `by` argument, so Prisma's type system fell back to its
#      internal "by must not be empty" error type instead of accepting the
#      call. Fixed by casting to the literal union of allowed field names
#      instead of `never` — Prisma recognises these as real scalar keys.
#
#   2. The test's `researcher` was a bare `{ sub: randomUUID(), role: ... }`
#      with no actual User row behind it — every other service's tests
#      create a real row before using its id as a foreign key, and this one
#      didn't. ResearchQuery.researcherId is a real FK to User (Restrict),
#      so any test that actually reaches the create() call hit a foreign
#      key violation. Fixed with a makeResearcher() helper, same pattern as
#      makeClinician() elsewhere.
#
# Run from the repo root:
#   bash fix-research.sh
#
set -euo pipefail

ROOT="$(pwd)"
DATASETS="$ROOT/services/research/src/engine/datasets.ts"
QUERY="$ROOT/services/research/src/services/query.service.ts"
TEST="$ROOT/services/research/src/tests/research.test.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$DATASETS" ] || { echo "services/research not set up."; exit 1; }

for f in "$DATASETS" "$QUERY" "$TEST"; do cp "$f" "$f.bak"; done

# ---------------------------------------------------------------------------
# 1. datasets.ts: name the allowed fields as a literal union, not string[]
# ---------------------------------------------------------------------------
node - "$DATASETS" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('AllowedGroupField')) {
  console.log('  datasets.ts already fixed');
} else {
  const old = `export interface DatasetBinding {
  datasetName: string;
  allowedGroupFields: string[];
}`;
  const replacement = `/** The only fields Prisma's groupBy will accept for this dataset — a literal
 * union, not \`string[]\`, so the cast at the call site stays type-checked
 * instead of falling back to \`never\`. */
export type AllowedGroupField = 'urgencyLevel' | 'channel' | 'status';

export interface DatasetBinding {
  datasetName: string;
  allowedGroupFields: AllowedGroupField[];
}`;
  if (!s.includes(old)) { console.error('  DatasetBinding interface anchor not found'); process.exit(1); }
  s = s.replace(old, replacement);
  fs.writeFileSync(p, s);
  console.log('  datasets.ts: AllowedGroupField union added');
}
NODE

# ---------------------------------------------------------------------------
# 2. query.service.ts: cast to the literal union instead of never
# ---------------------------------------------------------------------------
node - "$QUERY" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('AllowedGroupField')) {
  console.log('  query.service.ts already fixed');
} else {
  s = s.replace(
    "import { DATASET_BINDINGS } from '../engine/datasets.js';",
    "import { DATASET_BINDINGS, type AllowedGroupField } from '../engine/datasets.js';",
  );
  const old = `  const grouped = await prisma.consultationRequest.groupBy({
    by: input.query.group_by as never,
    _count: { _all: true },
  });`;
  const replacement = `  const grouped = await prisma.consultationRequest.groupBy({
    by: input.query.group_by as AllowedGroupField[],
    _count: { _all: true },
  });`;
  if (!s.includes(old)) { console.error('  groupBy call anchor not found'); process.exit(1); }
  s = s.replace(old, replacement);

  // The row/dims mapping below also needs `row` typed, since it comes off
  // the now-correctly-typed groupBy result rather than the error type.
  s = s.replace(
    "    .filter((row) => {",
    "    .filter((row: { _count: { _all: number } }) => {",
  );
  s = s.replace(
    "    .map((row) => {",
    "    .map((row: Record<string, unknown> & { _count: { _all: number } }) => {",
  );

  fs.writeFileSync(p, s);
  console.log('  query.service.ts: groupBy call and row callbacks typed correctly');
}
NODE

# ---------------------------------------------------------------------------
# 3. test: a real researcher User row, not a bare random UUID
# ---------------------------------------------------------------------------
node - "$TEST" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('makeResearcher')) {
  console.log('  research.test.ts already fixed');
} else {
  s = s.replace(
    "const admin = { role: 'platform_admin' };\nconst researcher = { sub: randomUUID(), role: 'researcher' };",
    "const admin = { role: 'platform_admin' };",
  );
  // Fallback in case the two consts weren't adjacent in this exact form.
  s = s.replace(
    "const researcher = { sub: randomUUID(), role: 'researcher' };\n",
    '',
  );

  const helperAnchor = 'async function makeConsultation(';
  if (!s.includes(helperAnchor)) { console.error('  makeConsultation anchor not found'); process.exit(1); }
  const helper = `async function makeResearcher() {
  const user = await prisma.user.create({
    data: { phoneNumber: \`+2557\${randomInt(10_000_000, 99_999_999)}\`, email: \`\${randomUUID()}@test.local\`, role: 'researcher', status: 'active', fullName: 'Test Researcher' },
  });
  users.push(user.id);
  return { sub: user.id, role: 'researcher' };
}

`;
  s = s.replace(helperAnchor, helper + helperAnchor);

  // Every call site that used the old static `researcher` now creates its own.
  s = s.replace(
    /it\('requires an ethics approval reference', async \(\) => \{\n    await seedDatasets\(\);/,
    "it('requires an ethics approval reference', async () => {\n    const researcher = await makeResearcher();\n    await seedDatasets();",
  );
  s = s.replace(
    /it\('refuses grouping by a field not on the allow-list', async \(\) => \{\n    await seedDatasets\(\);/,
    "it('refuses grouping by a field not on the allow-list', async () => {\n    const researcher = await makeResearcher();\n    await seedDatasets();",
  );
  s = s.replace(
    /it\('suppresses a cell below the minimum size and reports it', async \(\) => \{\n    await seedDatasets\(\);/,
    "it('suppresses a cell below the minimum size and reports it', async () => {\n    const researcher = await makeResearcher();\n    await seedDatasets();",
  );
  s = s.replace(
    /it\('refuses a stranger reading someone else.s query', async \(\) => \{\n    await seedDatasets\(\);/,
    "it('refuses a stranger reading someone else\\u2019s query', async () => {\n    const researcher = await makeResearcher();\n    await seedDatasets();",
  );

  fs.writeFileSync(p, s);
  console.log('  research.test.ts: makeResearcher() added, 4 call sites updated');
}
NODE

# --- verify ------------------------------------------------------------------
for f in "$DATASETS" "$QUERY" "$TEST"; do
  if grep -q "\bnever\[\]\|group_by as never\|randomUUID(), role: 'researcher'" "$f" 2>/dev/null; then
    echo "  WARNING: possible leftover in $(basename "$f") — check manually"
  fi
done
echo "  verified: fixes applied"

echo
echo "Next:"
echo "  pnpm --filter @a-health/research exec tsc --noEmit"
echo "  pnpm --filter @a-health/research test"
