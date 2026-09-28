#!/usr/bin/env bash
#
# Adds TriageRuleset — triage rules and SLA windows as versioned data rather
# than constants in a source file (FR-AD-03).
#
# THE DESIGN RULE: a ruleset is immutable once created. Editing means creating
# a new version, never mutating an existing one — including drafts.
#
# That is not tidiness. Every consultation stores triageRuleVersion so a
# decision can be explained months later against the rules that were actually
# live when it was made. If a version could be edited in place, that stamp
# would point at rules that no longer exist, and the audit trail would quietly
# become fiction.
#
# Run from the repo root:
#   bash expand-schema-triage-rules.sh
#
set -euo pipefail

ROOT="$(pwd)"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SCHEMA" ] || { echo "schema.prisma missing."; exit 1; }

cp "$SCHEMA" "$SCHEMA.pre-triage-rules"

node - "$SCHEMA" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('model TriageRuleset')) {
  console.log('  schema already has TriageRuleset');
  process.exit(0);
}

s = s.trimEnd() + '\n' + String.raw`
enum RulesetStatus {
  draft
  active
  retired
}

/// A versioned set of triage rules and SLA windows.
///
/// IMMUTABLE ONCE CREATED — including drafts. Editing means creating a new
/// version. ConsultationRequest.triageRuleVersion points here, so a decision
/// made last year must still resolve to the rules that actually made it; a
/// mutable row would turn that stamp into a lie.
///
/// Exactly one row may be active at a time, enforced by the service rather
/// than by a constraint, because activation also retires the previous one and
/// the two must happen together.
model TriageRuleset {
  id     String        @id @default(uuid()) @db.Uuid
  /// Human-chosen label, e.g. "2026.09.1". Written onto every consultation
  /// this ruleset judges.
  label  String        @unique @db.VarChar(40)
  status RulesetStatus @default(draft)

  /// The editable rules: red flags, urgent codes, specialty hints, age
  /// thresholds, chronic modifiers. Shape is validated by the service before
  /// a ruleset may be activated.
  rules Json

  /// { emergency, urgent, routine } in seconds. Versioned together with the
  /// rules because a consultation's stamp must explain both the urgency it
  /// was given and the deadline that followed from it.
  slaSeconds Json @map("sla_seconds")

  /// Why this version exists. Required on activation — a rule change nobody
  /// explained is one nobody can review.
  notes String?

  createdById String @map("created_by_id") @db.Uuid
  createdBy   User   @relation("TriageRulesetAuthor", fields: [createdById], references: [id], onDelete: Restrict)

  activatedById String?   @map("activated_by_id") @db.Uuid
  activatedBy   User?     @relation("TriageRulesetActivator", fields: [activatedById], references: [id], onDelete: Restrict)
  activatedAt   DateTime? @map("activated_at")
  retiredAt     DateTime? @map("retired_at")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([status])
  @@map("triage_rulesets")
}
`;

// The two back-relations on User. Anchored on the model's closing brace rather
// than on a neighbouring field, because prisma format realigns columns and any
// whitespace-based anchor breaks on the next run.
const userStart = s.indexOf('model User {');
if (userStart === -1) { console.error('  model User not found'); process.exit(1); }
const userEnd = s.indexOf('\n}', userStart);
if (userEnd === -1) { console.error('  could not find end of model User'); process.exit(1); }

const relations =
  '\n  authoredTriageRulesets  TriageRuleset[] @relation("TriageRulesetAuthor")' +
  '\n  activatedTriageRulesets TriageRuleset[] @relation("TriageRulesetActivator")';

s = s.slice(0, userEnd) + relations + s.slice(userEnd);

fs.writeFileSync(p, s);
console.log('  schema: TriageRuleset + RulesetStatus added, User back-relations wired');
NODE

python3 - "$SCHEMA" << 'PY'
import re, sys
src = open(sys.argv[1]).read()
code = "\n".join(l for l in src.splitlines()
                 if not l.strip().startswith("//") and not l.strip().startswith("///"))
models = re.findall(r'^model\s+(\w+)\s*\{', code, re.M)
enums = re.findall(r'^enum\s+(\w+)\s*\{', code, re.M)
print(f"  models: {len(models)} | enums: {len(enums)} | brace balance: {code.count('{') - code.count('}')}")
dupes = {m for m in models if models.count(m) > 1} | {e for e in enums if enums.count(e) > 1}
print(f"  duplicates: {dupes or 'none'}")
if dupes: sys.exit(1)
# both named relations must appear on User and on TriageRuleset
u = re.search(r'model User \{([\s\S]*?)\n\}', code).group(1)
for rel in ('TriageRulesetAuthor', 'TriageRulesetActivator'):
    assert rel in u, f'{rel} missing from User'
print("  User back-relations: both present")
PY

echo
echo "Next:"
echo "  pnpm --filter @a-health/database exec prisma format"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name add_triage_ruleset"
