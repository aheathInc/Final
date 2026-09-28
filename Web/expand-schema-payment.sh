#!/usr/bin/env bash
#
# Adds the payment models to the database schema: PaymentIntent, Payment,
# PaymentRefund. Mirrors the contract added by expand-contract-payment.sh.
#
# PaymentIntent and Payment are kept as separate models rather than one with
# a status column, because a mobile money intent and a settled payment have
# different write patterns: the intent is touched repeatedly while
# `processing` (by the webhook, by cancellation, by expiry), while a Payment
# is written once on settlement and only ever gains refunds after that. That
# split also means a webhook replay can never accidentally mutate a Payment
# that has already settled.
#
# Run from the repo root:
#   bash expand-schema-payment.sh
#
set -euo pipefail

ROOT="$(pwd)"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SCHEMA" ] || { echo "schema.prisma missing."; exit 1; }

cp "$SCHEMA" "$SCHEMA.pre-payment"

node - "$SCHEMA" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('model PaymentIntent')) {
  console.log('  schema already has payment models');
  process.exit(0);
}

function appendToModel(name, line) {
  const re = new RegExp(`(model ${name} \\{[\\s\\S]*?)(\\n\\})`);
  const m = s.match(re);
  if (!m) throw new Error(`model not found: ${name}`);
  s = s.replace(re, (_whole, body, close) => body + '\n' + line + close);
}

// --- back-relations on existing models --------------------------------------
appendToModel('User', '  paymentsMade PaymentIntent[] @relation("Payer")');
appendToModel('ConsultationRequest', '  paymentIntents PaymentIntent[]\n  payments        Payment[]');

// --- new enums and models ----------------------------------------------------
s = s.trimEnd() + '\n' + String.raw`
// ===========================================================================
// Payment
// ===========================================================================

enum PaymentMethod {
  mobile_money
  card
  cash
  insurance
}

enum PaymentProvider {
  mpesa
  tigo_pesa
  airtel_money
  card_gateway
  manual
}

enum PaymentPurpose {
  consultation_fee
  pharmacy_purchase
  insurance_copay
  subscription
  other
}

enum PaymentStatus {
  pending
  requires_action
  processing
  succeeded
  failed
  cancelled
  refunded
  partially_refunded
}

/// One per payable thing. Mobile money settles asynchronously — this row is
/// what exists between "the patient tapped pay" and "the provider confirmed
/// it", and it is touched repeatedly during that window: by the webhook, by
/// cancellation, by expiry. A settled Payment is created separately once this
/// resolves, so a late or replayed webhook can never mutate money already
/// counted as received.
model PaymentIntent {
  id       String         @id @default(uuid()) @db.Uuid
  amount   Decimal        @db.Decimal(12, 2)
  currency String         @default("TZS") @db.VarChar(3)
  method   PaymentMethod
  provider PaymentProvider?
  purpose  PaymentPurpose
  status   PaymentStatus  @default(pending)

  consultationId   String? @map("consultation_id") @db.Uuid
  consultation     ConsultationRequest? @relation(fields: [consultationId], references: [id], onDelete: Restrict)
  dispensingId     String? @map("dispensing_id") @db.Uuid
  insuranceClaimId String? @map("insurance_claim_id") @db.Uuid

  payerUserId String? @map("payer_user_id") @db.Uuid
  payer       User?   @relation("Payer", fields: [payerUserId], references: [id], onDelete: Restrict)
  payerPhone  String? @map("payer_phone") @db.VarChar(20)

  /// The provider's own transaction reference. Idempotency for the webhook is
  /// keyed on this, not on our own id — the provider is the one retrying.
  providerReference String? @unique @map("provider_reference") @db.VarChar(120)
  /// What the payer must do next (a USSD prompt, a redirect) — provider-shaped,
  /// so kept as JSON rather than a fixed column set.
  clientAction      Json?   @map("client_action")

  paymentId String? @unique @map("payment_id") @db.Uuid

  expiresAt DateTime? @map("expires_at")

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([status, createdAt])
  @@index([consultationId])
  @@index([updatedAt])
  @@map("payment_intents")
}

/// Written once, on settlement. Deliberately separate from PaymentIntent so a
/// row that represents money actually received cannot be touched by anything
/// except a refund.
model Payment {
  id              String         @id @default(uuid()) @db.Uuid
  paymentIntentId String         @unique @map("payment_intent_id") @db.Uuid

  amount           Decimal        @db.Decimal(12, 2)
  currency         String         @default("TZS") @db.VarChar(3)
  method           PaymentMethod
  provider         PaymentProvider?
  providerReference String?       @map("provider_reference") @db.VarChar(120)
  purpose          PaymentPurpose
  status           PaymentStatus  @default(succeeded)

  consultationId String? @map("consultation_id") @db.Uuid
  consultation   ConsultationRequest? @relation(fields: [consultationId], references: [id], onDelete: Restrict)
  payerUserId    String? @map("payer_user_id") @db.Uuid

  /// Running total across all PaymentRefund rows against this payment. Kept
  /// denormalised so "how much is left refundable" never requires summing the
  /// refunds table on every check.
  refundedAmount Decimal @default(0) @map("refunded_amount") @db.Decimal(12, 2)

  refunds PaymentRefund[]

  settledAt DateTime @map("settled_at")

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([status, settledAt])
  @@index([consultationId])
  @@map("payments")
}

/// A partial refund may be issued more than once against the same payment. A
/// table rather than a single column on Payment, because "who approved which
/// refund and why" has to survive as its own auditable record.
model PaymentRefund {
  id        String  @id @default(uuid()) @db.Uuid
  paymentId String  @map("payment_id") @db.Uuid
  payment   Payment @relation(fields: [paymentId], references: [id], onDelete: Restrict)

  amount            Decimal @db.Decimal(12, 2)
  reason            String
  issuedById        String? @map("issued_by_id") @db.Uuid
  providerReference String? @map("provider_reference") @db.VarChar(120)

  createdAt DateTime @default(now()) @map("created_at")

  @@index([paymentId])
  @@map("payment_refunds")
}
`;

fs.writeFileSync(p, s);
console.log('  schema: payment models added');
NODE

python3 - "$SCHEMA" << 'PY'
import re, sys
src = open(sys.argv[1]).read()
code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("//") and not l.strip().startswith("///"))

models = re.findall(r'^model\s+(\w+)\s*\{', code, re.M)
enums = re.findall(r'^enum\s+(\w+)\s*\{', code, re.M)
print(f"  models: {len(models)} | enums: {len(enums)} | brace balance: {code.count('{') - code.count('}')}")

dupes = {m for m in models if models.count(m) > 1} | {e for e in enums if enums.count(e) > 1}
print(f"  duplicates: {dupes or 'none'}")

scalars = {"String","Int","BigInt","Float","Boolean","DateTime","Json","Decimal","Bytes"}
known = set(models) | set(enums) | scalars
blocks = re.findall(r'^model\s+(\w+)\s*\{(.*?)^\}', code, re.M | re.S)
mf, bad = {}, []
for name, body in blocks:
    fs_ = []
    for line in body.splitlines():
        t = line.strip()
        if not t or t.startswith("@@"):
            continue
        m = re.match(r'(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)', t)
        if not m:
            continue
        fn, ft, lst, _opt, rest = m.groups()
        fs_.append(dict(name=fn, type=ft, list=bool(lst), attrs=rest))
        if ft not in known:
            bad.append(f"{name}.{fn}:{ft}")
    mf[name] = fs_
print(f"  unknown types: {bad or 'none'}")

miss = [f"{a}.{f['name']} -> {f['type']}" for a, fa in mf.items() for f in fa
        if f['type'] in mf and not any(g['type'] == a for g in mf[f['type']])]
print(f"  missing back-relations: {miss or 'none'}")

rel = re.findall(r'@relation\("(\w+)"', code)
unpaired = {n: rel.count(n) for n in set(rel) if rel.count(n) != 2}
print(f"  unpaired relation names: {unpaired or 'none'}")

prob = []
for a, fa in mf.items():
    for f in fa:
        if f['type'] not in mf or f['list'] or 'fields:' not in f['attrs']:
            continue
        backs = [g for g in mf[f['type']] if g['type'] == a]
        if not backs or any(g['list'] for g in backs):
            continue
        fk = re.search(r'fields:\s*\[(\w+)\]', f['attrs']).group(1)
        fkf = next((g for g in fa if g['name'] == fk), None)
        if fkf and '@unique' not in fkf['attrs']:
            prob.append(f"{a}.{fk}")
print(f"  1:1 FKs missing @unique: {prob or 'none'}")

log_only = {"OtpChallenge","RefreshToken","IdempotencyRecord","ChangeLog","AuditLog","NotificationLog",
            "EmergencyEvent","TransportPing","DeviceTelemetry","DeviceAlertRecipient","DispenseCode",
            "DispensingItem","InvestigationValue","CommunityMembership","SurveillanceRollup","AiInference",
            "PaymentRefund"}
mv = [m for m in models if m not in log_only and not any(f['name'] == 'version' for f in mf[m])]
mu = [m for m in models if m not in log_only and not any(f['name'] == 'updatedAt' for f in mf[m])]
print(f"  missing version: {mv or 'none'}")
print(f"  missing updatedAt: {mu or 'none'}")

if dupes or bad or miss or unpaired or prob or mv or mu:
    sys.exit(1)
PY

echo
echo "Next:"
echo "  pnpm --filter @a-health/database exec prisma format"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name add_payment"
