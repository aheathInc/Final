#!/usr/bin/env bash
#
# Same TS2339-family fix as quality: toCursorPage's shared return type is
# `data: unknown[]`, and the test did `result.data.map((a) => a.slug)`
# without narrowing the callback parameter's type first.
#
# Run from the repo root:
#   bash fix-education.sh
#
set -euo pipefail

ROOT="$(pwd)"
TEST="$ROOT/services/education/src/tests/education.test.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$TEST" ] || { echo "services/education tests not found."; exit 1; }

cp "$TEST" "$TEST.bak"

node - "$TEST" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const old = "const slugs = result.data.map((a) => a.slug);";
const replacement = "const slugs = (result.data as { slug: string }[]).map((a) => a.slug);";

if (s.includes(replacement)) {
  console.log('  already fixed');
} else if (!s.includes(old)) {
  console.error('  anchor not found');
  process.exit(1);
} else {
  s = s.replace(old, replacement);
  fs.writeFileSync(p, s);
  console.log('  education.test.ts: typed the cursor-page items at their one use site');
}
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/education exec tsc --noEmit"
echo "  pnpm --filter @a-health/education test"
