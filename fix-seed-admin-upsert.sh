#!/usr/bin/env bash
#
# seed-admin.ts tried to delete and recreate the admin account. Once that
# account has created a triage ruleset, the RESTRICT foreign key refuses the
# delete — correctly, because it is protecting the record of who authored an
# active clinical ruleset. The delete was swallowed by a .catch, and the
# following create then failed on the duplicate email.
#
# The fix is not to weaken the constraint. It is to stop destroying an account
# that legitimately accumulates references: upsert it instead, so re-running
# the seed refreshes the password without touching anything that points at it.
#
# Run from the repo root:
#   bash fix-seed-admin-upsert.sh
#
set -euo pipefail

ROOT="$(pwd)"
SEED="$ROOT/services/auth/scripts/seed-admin.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SEED" ] || { echo "seed-admin.ts not found — run seed-dev-admin.sh first."; exit 1; }

cp "$SEED" "$SEED.bak"

node - "$SEED" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
let changes = 0;

// 1. Stop deleting the admin in wipe().
const oldDelete = "  if (admin) await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);";
if (s.includes(oldDelete)) {
  s = s.replace(
    oldDelete,
    "  // The admin is deliberately not deleted. Once it has authored a triage\n" +
    "  // ruleset or an audit entry, a RESTRICT foreign key refuses — and it is\n" +
    "  // right to: those records name who made the decision. main() upserts it.",
  );
  changes++;
}

// Some versions wrote it as a block; handle that shape too.
const oldBlock = `  if (admin) {
    await prisma.clinicianProfile.deleteMany({ where: { userId: admin.id } });
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  }`;
if (s.includes(oldBlock)) {
  s = s.replace(
    oldBlock,
    "  // The admin is deliberately not deleted — see main()'s upsert.",
  );
  changes++;
}

// 2. Upsert rather than create.
const oldCreate = `  await prisma.user.create({
    data: {
      phoneNumber: \`+2557\${randomInt(10_000_000, 99_999_999)}\`,
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
      role: 'platform_admin',
      status: 'active',
      fullName: 'Neema Kilonzo',
    },
  });`;

const newCreate = `  // Upsert, so re-running refreshes the password without disturbing anything
  // this account has already authored.
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      passwordHash: adminHash,
      role: 'platform_admin',
      status: 'active',
      fullName: 'Neema Kilonzo',
    },
    create: {
      phoneNumber: \`+2557\${randomInt(10_000_000, 99_999_999)}\`,
      email: ADMIN_EMAIL,
      passwordHash: adminHash,
      role: 'platform_admin',
      status: 'active',
      fullName: 'Neema Kilonzo',
    },
  });`;

if (s.includes('prisma.user.upsert')) {
  console.log('  already upserting the admin');
} else if (!s.includes(oldCreate)) {
  console.error('  admin create anchor not found — the file differs from what I shipped');
  process.exit(1);
} else {
  s = s.replace(oldCreate, newCreate);
  changes++;
}

fs.writeFileSync(p, s);
const after = fs.readFileSync(p, 'utf8');
if (after.includes('prisma.user.delete({ where: { id: admin.id } })')) {
  console.error('  VERIFY FAILED: admin delete still present');
  process.exit(1);
}
if (!after.includes('prisma.user.upsert')) {
  console.error('  VERIFY FAILED: upsert not written');
  process.exit(1);
}
console.log(`  seed-admin.ts: ${changes} edit(s), verified on disk`);
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/auth exec tsx scripts/seed-admin.ts"
