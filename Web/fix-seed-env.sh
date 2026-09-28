#!/usr/bin/env bash
#
# The seed scripts import Prisma directly and never load .env, so they only
# worked in a shell where DATABASE_URL happened to be exported. In a fresh
# terminal they fail — and the error names Prisma, which sends you looking at
# the database rather than at the missing variable.
#
# The services themselves are fine: their config/env.ts calls dotenv.config().
# The seeds skipped that step. This adds it.
#
# `pnpm --filter @a-health/auth exec` runs with services/auth as the working
# directory, which is exactly where that .env lives.
#
# Run from the repo root:
#   bash fix-seed-env.sh
#
set -euo pipefail

ROOT="$(pwd)"
[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }

patched=0
for name in seed-dev seed-admin; do
  f="$ROOT/services/auth/scripts/$name.ts"
  [ -f "$f" ] || { echo "  skip (not present): scripts/$name.ts"; continue; }

  if head -6 "$f" | grep -q "dotenv/config"; then
    echo "  already loads .env: scripts/$name.ts"
    continue
  fi

  cp "$f" "$f.bak"
  node - "$f" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
const s = fs.readFileSync(p, 'utf8');

// Must come before anything that touches Prisma: the client reads
// DATABASE_URL when it is constructed, and @a-health/database constructs it at
// import time. A dotenv call placed after that import is too late.
const header = `// Loads services/auth/.env. Must be the first import: @a-health/database
// constructs the Prisma client at import time, and the client reads
// DATABASE_URL then — a dotenv call placed after it would run too late.
import 'dotenv/config';
`;

fs.writeFileSync(p, header + s);
NODE

  if head -5 "$f" | grep -q "dotenv/config"; then
    echo "  patched: scripts/$name.ts"
    patched=$((patched + 1))
  else
    echo "  VERIFY FAILED on scripts/$name.ts"
    exit 1
  fi
done

echo
echo "  $patched file(s) patched"
echo
echo "Now works from any terminal, no export needed:"
echo "  pnpm --filter @a-health/auth exec tsx scripts/seed-dev.ts"
echo "  pnpm --filter @a-health/auth exec tsx scripts/seed-admin.ts"
