#!/usr/bin/env bash
#
# One TS2339 fix: toCursorPage's return type is `data: unknown[]` (the shared
# generic doesn't propagate the map callback's return shape). The test read
# `result.data[0]!.escalated_to_governance` directly off that unknown array —
# a non-null assertion on `unknown` narrows to `{}` in TypeScript, and `{}`
# has no known properties, so the property access fails to compile even
# though the value is correct at runtime (which is exactly why tsx let all
# 10 tests pass: it strips types and never saw this).
#
# Fixed at the one call site with a local type, rather than touching
# packages/http's toCursorPage signature — that generic is shared by every
# service using cursor pagination, and loosening it project-wide is a much
# bigger change than this one assertion needs.
#
# Run from the repo root:
#   bash fix-quality.sh
#
set -euo pipefail

ROOT="$(pwd)"
TEST="$ROOT/services/quality/src/tests/quality.test.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$TEST" ] || { echo "services/quality tests not found."; exit 1; }

cp "$TEST" "$TEST.bak"

node - "$TEST" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const old = "    assert.equal(result.data[0]!.escalated_to_governance, true);";
const replacement =
  "    const first = result.data[0] as { escalated_to_governance: boolean };\n" +
  "    assert.equal(first.escalated_to_governance, true);";

if (s.includes(replacement.split('\n')[0])) {
  console.log('  already fixed');
} else if (!s.includes(old)) {
  console.error('  anchor not found');
  process.exit(1);
} else {
  s = s.replace(old, replacement);
  fs.writeFileSync(p, s);
  console.log('  quality.test.ts: typed the cursor-page item at its one use site');
}
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/quality exec tsc --noEmit"
echo "  pnpm --filter @a-health/quality test"
