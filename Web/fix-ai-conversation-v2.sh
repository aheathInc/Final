#!/usr/bin/env bash
#
# Corrected version of fix-ai-conversation.sh.
#
# The first version anchored on a whitespace-exact line
# (`insuranceMemberships  InsuranceMembership[]`) to place the new
# back-relation. `prisma format` — which you have run several times — realigns
# field columns per model, so that exact spacing no longer existed and the
# anchor failed. Because the file write happened once, at the very end, after
# BOTH model edits, the failed second edit meant NEITHER was written —
# including the AiConversation edit that had already "succeeded" in memory.
#
# This version never anchors on other fields' spacing: it always appends the
# new field immediately before a model's closing brace, which needs nothing
# but the model existing. Each edit writes independently, so a problem with
# one model can no longer silently discard a working edit to another.
#
# Safe to run again even though the first attempt made no changes at all.
#
# Run from the repo root:
#   bash fix-ai-conversation-v2.sh
#
set -euo pipefail

ROOT="$(pwd)"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"
REGISTRY="$ROOT/services/ai/src/services/registry.ts"
TEST="$ROOT/services/ai/src/tests/ai.test.ts"
CONVO="$ROOT/services/ai/src/services/conversation.service.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SCHEMA" ] || { echo "schema.prisma missing."; exit 1; }
[ -f "$REGISTRY" ] || { echo "services/ai not set up."; exit 1; }

cp "$SCHEMA" "$SCHEMA.bak2"
cp "$REGISTRY" "$REGISTRY.bak2"
cp "$TEST" "$TEST.bak2"
cp "$CONVO" "$CONVO.bak2"

# ---------------------------------------------------------------------------
# 1. Schema: append the field to each model's end, not mid-body
# ---------------------------------------------------------------------------
node - "$SCHEMA" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
let changed = false;

/**
 * Appends `line` just before a model's closing brace. Never depends on any
 * other field's text or spacing — only on the model existing — which is what
 * makes it safe across repeated `prisma format` runs.
 */
function appendToModel(name, line) {
  const re = new RegExp(`(model ${name} \\{[\\s\\S]*?)(\\n\\})`);
  const m = s.match(re);
  if (!m) throw new Error(`model not found: ${name}`);
  return s.replace(re, (_whole, body, close) => body + '\n' + line + close);
}

function modelHas(name, needle) {
  const m = s.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model not found: ${name}`);
  return m[1].includes(needle);
}

if (modelHas('AiConversation', 'patientProfileId')) {
  console.log('  AiConversation already has patientProfileId');
} else {
  s = appendToModel(
    'AiConversation',
    '  patientProfileId String?         @map("patient_profile_id") @db.Uuid\n' +
    '  patient          PatientProfile? @relation(fields: [patientProfileId], references: [id], onDelete: Restrict)',
  );
  changed = true;
  console.log('  AiConversation: patientProfileId appended');
}

if (modelHas('PatientProfile', 'aiConversations')) {
  console.log('  PatientProfile already has the aiConversations back-relation');
} else {
  s = appendToModel('PatientProfile', '  aiConversations AiConversation[]');
  changed = true;
  console.log('  PatientProfile: aiConversations back-relation appended');
}

if (changed) {
  fs.writeFileSync(p, s);
  console.log('  schema.prisma written');
} else {
  console.log('  no schema changes needed');
}

// Verify against what is actually on disk now, not the in-memory string —
// catches the exact failure mode that happened last time.
const onDisk = fs.readFileSync(p, 'utf8');
const aic = onDisk.match(/model AiConversation \{([\s\S]*?)\n\}/);
const pp = onDisk.match(/model PatientProfile \{([\s\S]*?)\n\}/);
if (!aic || !aic[1].includes('patientProfileId')) {
  console.error('  VERIFY FAILED: AiConversation.patientProfileId not on disk');
  process.exit(1);
}
if (!pp || !pp[1].includes('aiConversations')) {
  console.error('  VERIFY FAILED: PatientProfile.aiConversations not on disk');
  process.exit(1);
}
console.log('  verified on disk: both sides of the relation present');
NODE

# ---------------------------------------------------------------------------
# 2. Registry: stub entry, seeded active
# ---------------------------------------------------------------------------
node - "$REGISTRY" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes("key: 'stub'")) {
  console.log('  registry already includes the stub entry');
} else {
  const anchor = 'export const MODEL_SHORTLIST: ModelSeed[] = [';
  if (!s.includes(anchor)) { console.error('  MODEL_SHORTLIST anchor not found'); process.exit(1); }
  s = s.replace(
    anchor,
    anchor +
      "\n  // Not one of the 15 shortlisted models — the deterministic fallback this" +
      "\n  // service actually runs on by default. Registered because it is what is" +
      "\n  // really handling every request under the default config, and that is" +
      "\n  // precisely the fact a governance registry exists to surface, not hide." +
      "\n  { key: 'stub', displayName: 'Rule-based stub', function: 'Deterministic offline fallback for chat, used when no model provider is configured', runtime: 'in-process' },",
  );
  s = s.replace(
    "        status: 'not_deployed',",
    "        status: model.key === 'stub' ? 'active' : 'not_deployed',",
  );
  fs.writeFileSync(p, s);
  console.log('  registry: stub entry added, seeded as active');
}
NODE

# ---------------------------------------------------------------------------
# 3. Test: narrow the flawed self-matching assertion
# ---------------------------------------------------------------------------
node - "$TEST" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('you have (a|an)')) {
  console.log('  test already patched');
} else {
  const old = 'assert.ok(!/you have|diagnos/i.test(result.text));';
  if (!s.includes(old)) { console.error('  test anchor not found'); process.exit(1); }
  s = s.replace(
    old,
    '// Checks for an actual diagnostic claim shape, not the bare substring\n' +
    '    // "diagnos" — the stub\'s own refusal ("I cannot diagnose") contains that\n' +
    '    // substring and would otherwise fail this test against itself.\n' +
    '    assert.ok(!/you have (a|an)\\s|your diagnosis is/i.test(result.text));',
  );
  fs.writeFileSync(p, s);
  console.log('  test: never-diagnoses assertion narrowed');
}
NODE

# ---------------------------------------------------------------------------
# 4. conversation.service.ts: actually store patient_profile_id on create
# ---------------------------------------------------------------------------
node - "$CONVO" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('patientProfileId: input.patient_profile_id')) {
  console.log('  conversation.service.ts already wires patient_profile_id');
} else {
  const old = '      careThreadId: input.care_thread_id ?? null,\n      language:';
  if (!s.includes(old)) { console.error('  conversation service anchor not found'); process.exit(1); }
  s = s.replace(
    old,
    '      careThreadId: input.care_thread_id ?? null,\n      patientProfileId: input.patient_profile_id ?? null,\n      language:',
  );
  fs.writeFileSync(p, s);
  console.log('  conversation.service.ts: patient_profile_id now stored on create');
}
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/database exec prisma format"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name ai_conversation_patient"
echo "  pnpm --filter @a-health/ai exec tsc --noEmit"
echo "  pnpm --filter @a-health/ai test"
