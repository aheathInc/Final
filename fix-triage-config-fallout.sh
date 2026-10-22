#!/usr/bin/env bash
#
# Two bugs left behind by setup-triage-config.sh. Neither comes from the
# consultation read endpoints — both were already there and only surfaced when
# tsc and the tests ran again.
#
# 1. That script removed `const SLA = {...}` because SLA windows now travel
#    with the active ruleset. It replaced ONE of the two usages. The referral
#    path still says SLA.routine, so the service no longer compiles.
#
# 2. Specialty routing lost its ordering. A symptom hint (rash -> dermatology)
#    is applied first, and the paediatric check then refuses to fire because it
#    requires the specialty to still be general_practice. A six-year-old with a
#    rash was being routed to dermatology.
#
#    Age should win over a symptom hint for a child: a paediatrician treats a
#    child's rash. Obstetric routing is assigned AFTER the age check, so it
#    still takes precedence over both — a pregnant patient is not sent to
#    paediatrics.
#
# Run from the repo root:
#   bash fix-triage-config-fallout.sh
#
set -euo pipefail

ROOT="$(pwd)"
SERVICE="$ROOT/services/consultation/src/services/consultation.service.ts"
TRIAGE="$ROOT/services/consultation/src/engine/triage.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SERVICE" ] || { echo "consultation.service.ts not found."; exit 1; }
[ -f "$TRIAGE" ] || { echo "engine/triage.ts not found."; exit 1; }

cp "$SERVICE" "$SERVICE.bak"
cp "$TRIAGE" "$TRIAGE.bak"

# --- 1. the orphaned SLA reference -----------------------------------------
node - "$SERVICE" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (!s.includes('SLA.routine')) {
  console.log('  consultation.service.ts: no orphaned SLA reference');
  process.exit(0);
}

// A referral inherits the source consultation's urgency, so its deadline
// should come from the same configured windows rather than a constant that no
// longer exists. Reading the active ruleset here keeps a referral's deadline
// explainable by the same stamped version as everything else.
const old = '      slaDeadlineAt: new Date(Date.now() + SLA.routine * 1000),';
const replacement = '      slaDeadlineAt: new Date(Date.now() + referralSla * 1000),';
if (!s.includes(old)) { console.error('  slaDeadlineAt anchor not found'); process.exit(1); }
s = s.replace(old, replacement);

// Declare it just before the create that uses it.
const createAnchor = '  const referral = await prisma.consultationRequest.create({';
if (!s.includes(createAnchor)) { console.error('  referral create anchor not found'); process.exit(1); }
s = s.replace(
  createAnchor,
  '  const referralRuleset = await activeRuleset();\n' +
  '  const referralSla = referralRuleset.sla.routine;\n\n' +
  createAnchor,
);

fs.writeFileSync(p, s);
const after = fs.readFileSync(p, 'utf8');
if (after.includes('SLA.routine') || !after.includes('referralSla')) {
  console.error('  VERIFY FAILED'); process.exit(1);
}
console.log('  consultation.service.ts: referral deadline now uses the active ruleset');
NODE

# --- 2. specialty ordering --------------------------------------------------
node - "$TRIAGE" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const old = `    if (age < rules.paediatricMaxAgeYears && specialty === 'general_practice') {
      specialty = 'paediatrics';
    }`;
const replacement = `    // Deliberately not guarded on general_practice: a child's rash belongs to
    // a paediatrician, not a dermatologist, so age overrides a symptom hint.
    // Obstetric routing is assigned after this block and still wins, which is
    // why a pregnant patient is never sent to paediatrics.
    if (age < rules.paediatricMaxAgeYears) {
      specialty = 'paediatrics';
    }`;

if (s.includes(replacement)) {
  console.log('  triage.ts: specialty ordering already fixed');
  process.exit(0);
}
if (!s.includes(old)) { console.error('  paediatric routing anchor not found'); process.exit(1); }

s = s.replace(old, replacement);
fs.writeFileSync(p, s);

const after = fs.readFileSync(p, 'utf8');
if (after.includes("age < rules.paediatricMaxAgeYears && specialty === 'general_practice'")) {
  console.error('  VERIFY FAILED'); process.exit(1);
}
console.log('  triage.ts: age now overrides a symptom hint for children');
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/consultation exec tsc --noEmit"
echo "  pnpm --filter @a-health/consultation test"
