#!/usr/bin/env bash
#
# Adds UssdSession to the schema. The contract's own description says
# sessions are held "in Redis" — but nothing else in this stack uses Redis,
# and Postgres is already running everything else (the event bus, every
# realtime ticket). One more table is cheaper than one more moving part.
#
# Run from the repo root:
#   bash expand-schema-gateway.sh
#
set -euo pipefail

ROOT="$(pwd)"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SCHEMA" ] || { echo "schema.prisma missing."; exit 1; }

cp "$SCHEMA" "$SCHEMA.pre-gateway"

node - "$SCHEMA" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('model UssdSession')) {
  console.log('  schema already has UssdSession');
  process.exit(0);
}

s = s.trimEnd() + '\n' + String.raw`
/// Postgres-backed USSD session state. The contract's own description says
/// "in Redis" — but nothing else here runs Redis, and every other short-lived
/// credential in this platform (OtpChallenge, RealtimeTicket) already lives
/// in Postgres. One more table costs less than one more service to operate.
///
/// Short-lived and single-purpose like those two — no version/updatedAt.
model UssdSession {
  id            String   @id @default(uuid()) @db.Uuid
  sessionId     String   @unique @map("session_id") @db.VarChar(100)
  phoneNumber   String   @map("phone_number") @db.VarChar(20)
  /// Where in the menu tree this session currently is — the bridge's own
  /// small state machine, not the aggregator's raw accumulated text.
  menuState     String   @default("root") @map("menu_state") @db.VarChar(60)
  /// Free-form data the current menu step needs to remember (e.g. a partial
  /// symptom description before the final confirm).
  context       Json     @default("{}")
  createdAt     DateTime @default(now()) @map("created_at")
  expiresAt     DateTime @map("expires_at")

  @@index([expiresAt])
  @@map("ussd_sessions")
}
`;

fs.writeFileSync(p, s);
console.log('  schema: UssdSession added');
NODE

python3 - "$SCHEMA" << 'PY'
import re, sys
src = open(sys.argv[1]).read()
code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("//") and not l.strip().startswith("///"))
models = re.findall(r'^model\s+(\w+)\s*\{', code, re.M)
print(f"  models: {len(models)} | brace balance: {code.count('{') - code.count('}')}")
dupes = {m for m in models if models.count(m) > 1}
print(f"  duplicates: {dupes or 'none'}")
if dupes: sys.exit(1)
PY

echo
echo "Next:"
echo "  pnpm --filter @a-health/database exec prisma format"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name add_ussd_session"
