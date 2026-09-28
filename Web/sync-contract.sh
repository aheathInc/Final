#!/usr/bin/env bash
#
# Compares your contract against the one shipped alongside this script, and
# copies it in only if nothing of yours would be lost.
#
# Overwriting a contract blind is how it silently went from 108 paths to 47
# earlier in this build, and that went unnoticed for four services. So this
# refuses rather than assumes.
#
# Usage, from the repo root, with the new yaml beside it:
#   bash sync-contract.sh a-health-api-v1.yaml
#
set -euo pipefail

ROOT="$(pwd)"
NEW="${1:-a-health-api-v1.yaml}"
CUR="$ROOT/packages/api/openapi/a-health-api-v1.yaml"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$NEW" ] || { echo "Not found: $NEW"; exit 1; }
[ -f "$CUR" ] || { echo "Your contract is missing: ${CUR#$ROOT/}"; exit 1; }

python3 - "$CUR" "$NEW" << 'PY'
import sys, yaml, shutil, os
cur_path, new_path = sys.argv[1], sys.argv[2]
cur = set(yaml.safe_load(open(cur_path))['paths'])
new = set(yaml.safe_load(open(new_path))['paths'])

only_yours = sorted(cur - new)
only_new = sorted(new - cur)

print(f"  yours: {len(cur)} paths")
print(f"  new:   {len(new)} paths")
print()

if only_yours:
    print("  REFUSING TO COPY — these exist only in your contract and would be lost:")
    for p in only_yours:
        print(f"    {p}")
    print()
    print("  Tell me about these before we merge; they are not in what I shipped.")
    sys.exit(1)

if not only_new:
    print("  Identical. Nothing to do.")
    sys.exit(0)

print("  These will be added:")
for p in only_new:
    print(f"    + {p}")

shutil.copy(cur_path, cur_path + ".bak")
shutil.copy(new_path, cur_path)

check = yaml.safe_load(open(cur_path))
print()
print(f"  copied. now {len(check['paths'])} paths (backup at {os.path.basename(cur_path)}.bak)")
PY
