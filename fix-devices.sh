#!/usr/bin/env bash
#
# One TS2345: the zod schema's `unit: z.string().nullable().optional()`
# produces `string | null | undefined`, but ingestTelemetry's parameter type
# only declared `unit?: string` (string | undefined, no null). Widened the
# function's own type to match what the validated input actually carries —
# the Prisma call already handled `?? null` correctly either way, only the
# type signature was too narrow.
#
# Run from the repo root:
#   bash fix-devices.sh
#
set -euo pipefail

ROOT="$(pwd)"
TELEMETRY="$ROOT/services/devices/src/services/telemetry.service.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$TELEMETRY" ] || { echo "services/devices not set up."; exit 1; }

cp "$TELEMETRY" "$TELEMETRY.bak"

node - "$TELEMETRY" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const old = "  readings: { metric: string; value: number; unit?: string; recorded_at: string }[],";
const replacement = "  readings: { metric: string; value: number; unit?: string | null; recorded_at: string }[],";

if (s.includes(replacement)) {
  console.log('  already fixed');
} else if (!s.includes(old)) {
  console.error('  ingestTelemetry parameter anchor not found');
  process.exit(1);
} else {
  s = s.replace(old, replacement);
  fs.writeFileSync(p, s);
  console.log('  telemetry.service.ts: unit type widened to string | null | undefined');
}
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/devices exec tsc --noEmit"
echo "  pnpm --filter @a-health/devices test"
