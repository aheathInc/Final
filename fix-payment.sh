#!/usr/bin/env bash
#
# Three real bugs found in services/payment's first test run:
#
#   1. TS2345 — created.provider_reference is string|null (matches the
#      nullable Prisma column), but handleWebhook's payload type demanded
#      string|undefined. Coerced at the one call site that hit it.
#
#   2. A mobile money intent goes straight to status 'processing' on
#      creation (the console adapter's push happens synchronously), but
#      cancelPaymentIntent only allowed cancelling from 'pending' or
#      'requires_action' — so a mobile money intent could never be
#      cancelled at all. 'processing' is exactly the "waiting on the payer
#      to confirm on their phone" window, which is genuinely cancellable,
#      so it's added to the allowed set.
#
#   3. The webhook settlement test tried to override
#      process.env.WEBHOOK_SECRET_MPESA at runtime — but env.ts parses
#      process.env into the frozen `env` object once, at module import
#      time (via dotenv + zod). webhook.service.ts had already captured
#      env.WEBHOOK_SECRET_MPESA into its SECRETS map before the test ever
#      ran, so the runtime mutation did nothing, and the test signed its
#      payload with a different secret than the one actually checked.
#      Fixed by using the real, already-baked-in secret from .env instead
#      of trying to inject a new one after the fact.
#
# Run from the repo root:
#   bash fix-payment.sh
#
set -euo pipefail

ROOT="$(pwd)"
INTENT="$ROOT/services/payment/src/services/intent.service.ts"
TEST="$ROOT/services/payment/src/tests/payment.test.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$INTENT" ] || { echo "services/payment not set up."; exit 1; }
[ -f "$TEST" ] || { echo "services/payment tests not found."; exit 1; }

cp "$INTENT" "$INTENT.bak"
cp "$TEST" "$TEST.bak"

# ---------------------------------------------------------------------------
# 1 & 2: intent.service.ts — cancel guard includes 'processing'
# ---------------------------------------------------------------------------
node - "$INTENT" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const old = `  if (intent.status !== 'pending' && intent.status !== 'requires_action') {
    throw conflict('STATE_TRANSITION_INVALID', \`Cannot cancel a payment intent in status "\${intent.status}"\`);
  }`;

if (s.includes("intent.status !== 'processing'")) {
  console.log('  intent.service.ts already fixed');
} else if (!s.includes(old)) {
  console.error('  cancel-guard anchor not found');
  process.exit(1);
} else {
  const replacement = `  // 'processing' is included deliberately: a mobile money intent moves
  // straight there on creation (the provider push happens synchronously),
  // and that is exactly the "waiting on the payer to confirm" window — the
  // one moment cancellation is actually meaningful for mobile money.
  if (intent.status !== 'pending' && intent.status !== 'requires_action' && intent.status !== 'processing') {
    throw conflict('STATE_TRANSITION_INVALID', \`Cannot cancel a payment intent in status "\${intent.status}"\`);
  }`;
  s = s.replace(old, replacement);
  fs.writeFileSync(p, s);
  console.log('  intent.service.ts: cancel now allowed from processing');
}
NODE

# ---------------------------------------------------------------------------
# 3. types + webhook secret test fix
# ---------------------------------------------------------------------------
node - "$TEST" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
let changes = 0;

// --- fix 1: null -> undefined at the one call site that needs it ----------
const old1 = 'const payload = { provider_reference: created.provider_reference, status: \'succeeded\' };';
const new1 = 'const payload = { provider_reference: created.provider_reference ?? undefined, status: \'succeeded\' };';
if (s.includes(old1)) { s = s.replace(old1, new1); changes++; }

// --- fix 3: stop mutating process.env after module load; use the real,
// already-baked-in secret from .env instead ---------------------------------
const oldBlock = `describe('webhook settlement', () => {
  const secret = 'itest-mpesa-secret';
  const originalSecret = process.env.WEBHOOK_SECRET_MPESA;

  it('settles a processing intent into a Payment', async () => {
    process.env.WEBHOOK_SECRET_MPESA = secret;
    const user = await makeUser();`;

const newBlock = `describe('webhook settlement', () => {
  // env.ts parses process.env into a frozen object once, at module import
  // time. Mutating process.env after that point (as a previous version of
  // this test tried to do) has no effect on what webhook.service.ts already
  // captured — so the secret used here has to be the one actually baked into
  // .env at startup, not one injected at runtime.
  const secret = env.WEBHOOK_SECRET_MPESA;

  it('settles a processing intent into a Payment', async () => {
    const user = await makeUser();`;

if (s.includes(oldBlock)) { s = s.replace(oldBlock, newBlock); changes++; }
else console.log('  webhook-settlement describe block anchor not found (may already be fixed)');

const oldRestore = "    process.env.WEBHOOK_SECRET_MPESA = originalSecret;\n";
if (s.includes(oldRestore)) { s = s.replace(oldRestore, ''); changes++; }

// --- import env so the test can reference the real secret ------------------
if (!s.includes("import { env } from '../config/env.js';") && !s.includes('env.WEBHOOK_SECRET_MPESA') === false) {
  const importAnchor = "import { createConsoleAdapter, type ProviderAdapter } from '../adapters/provider.js';";
  if (s.includes(importAnchor) && !s.includes("import { env } from '../config/env.js';")) {
    s = s.replace(importAnchor, importAnchor + "\nimport { env } from '../config/env.js';");
    changes++;
  }
}

console.log(`  payment.test.ts: ${changes} edit(s) applied`);
fs.writeFileSync(p, s);

// --- verify ------------------------------------------------------------------
const onDisk = fs.readFileSync(p, 'utf8');
if (onDisk.includes("process.env.WEBHOOK_SECRET_MPESA =")) {
  console.error('  VERIFY FAILED: a process.env.WEBHOOK_SECRET_MPESA mutation remains');
  process.exit(1);
}
if (!onDisk.includes('provider_reference: created.provider_reference ?? undefined')) {
  console.error('  VERIFY FAILED: the null-coalescing fix did not land');
  process.exit(1);
}
if (!onDisk.includes("import { env } from '../config/env.js';")) {
  console.error('  VERIFY FAILED: env import missing');
  process.exit(1);
}
console.log('  verified on disk: all three test-file fixes present');
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/payment exec tsc --noEmit"
echo "  pnpm --filter @a-health/payment test"
