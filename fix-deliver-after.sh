#!/usr/bin/env bash
#
# Moves deliverAfter from OtpChallenge, where my installer put it by mistake,
# to NotificationLog, where it belongs.
#
# The cause: the patch anchored on the field name `attempts Int`, and
# OtpChallenge has that field too, earlier in the file. A field-name anchor is
# not unique; only a model-scoped one is. Every schema patch from here matches
# `model <Name> {` first.
#
# Run from the repo root:
#   bash fix-deliver-after.sh
#
set -euo pipefail

ROOT="$(pwd)"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SCHEMA" ] || { echo "schema.prisma missing."; exit 1; }

cp "$SCHEMA" "$SCHEMA.bak"

node - "$SCHEMA" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

function modelBody(name) {
  const re = new RegExp(`(model ${name} \\{)([\\s\\S]*?)(\\n\\})`);
  const m = s.match(re);
  if (!m) throw new Error(`model not found: ${name}`);
  return { re, head: m[1], body: m[2], close: m[3] };
}

// --- 1. strip it out of OtpChallenge, comments included -------------------
{
  const { re, head, body, close } = modelBody('OtpChallenge');
  const lines = body.split('\n');
  const idx = lines.findIndex((l) => l.includes('deliverAfter'));
  if (idx === -1) {
    console.log('  OtpChallenge is already clean');
  } else {
    let start = idx;
    while (start > 0 && (lines[start - 1].trim().startsWith('///') || lines[start - 1].trim() === '')) {
      start -= 1;
    }
    lines.splice(start, idx - start + 1);
    s = s.replace(re, head + lines.join('\n') + close);
    console.log('  removed deliverAfter from OtpChallenge');
  }
}

// --- 2. put it on NotificationLog ----------------------------------------
{
  const { re, head, body, close } = modelBody('NotificationLog');
  if (body.includes('deliverAfter')) {
    console.log('  NotificationLog already has deliverAfter');
  } else {
    const added =
      '\n\n  /// Hold the notification until this time. An in-app message that the' +
      '\n  /// recipient reads within the grace window is never sent again over SMS —' +
      '\n  /// without this the platform would charge itself, and annoy the patient,' +
      '\n  /// for every message they had already seen.' +
      '\n  deliverAfter DateTime? @map("deliver_after")';
    s = s.replace(re, head + body + added + close);
    console.log('  added deliverAfter to NotificationLog');
  }
}

fs.writeFileSync(p, s);

// --- 3. prove it landed where it was meant to ----------------------------
const check = fs.readFileSync(p, 'utf8');
for (const [name, expected] of [['OtpChallenge', false], ['NotificationLog', true]]) {
  const m = check.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  const has = Boolean(m && m[1].includes('deliverAfter'));
  if (has !== expected) {
    console.error(`  VERIFY FAILED: ${name} deliverAfter=${has}, expected ${expected}`);
    process.exit(1);
  }
}
console.log('  verified: OtpChallenge clean, NotificationLog has the column');
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/database exec prisma format"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name notification_deliver_after"
echo "  pnpm --filter @a-health/notification exec tsc --noEmit"
echo "  pnpm --filter @a-health/notification test"
