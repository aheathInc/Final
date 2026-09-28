#!/usr/bin/env bash
#
# Finds which layer is rejecting the request.
#
# A 401 from /bff has exactly two possible causes and they need opposite fixes:
#   A. next-auth has no token for the proxy to read  -> the session is the problem
#   B. the backend refuses the token it was given    -> the token's contents are
#
# This walks the same path a browser request takes, one hop at a time.
#
# Run from the repo root:
#   bash diagnose-401.sh
#
set -uo pipefail

ROOT="$(pwd)"
EMAIL="${1:-daktari@dev.local}"
PASSWORD="${2:-Daktari#2026}"

echo "── 1. Does the auth service accept these credentials?"
LOGIN=$(curl -s -X POST http://localhost:4001/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"device_id\":\"diagnose\"}")

TOKEN=$(printf '%s' "$LOGIN" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('access_token',''))
except Exception: print('')" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "   NO. The login itself failed:"
  printf '   %s\n' "$(printf '%s' "$LOGIN" | head -c 400)"
  echo
  echo "   Re-run the seed:  pnpm --filter @a-health/auth exec tsx scripts/seed-dev.ts"
  exit 1
fi
echo "   yes — got an access token"

echo
echo "── 2. What is inside that token?"
printf '%s' "$TOKEN" | python3 -c "
import sys, json, base64
raw = sys.stdin.read().split('.')[1]
raw += '=' * (-len(raw) % 4)
c = json.loads(base64.urlsafe_b64decode(raw))
for k in ('sub','role','status','cpid','vst','ppid'):
    print(f'   {k:8} {c.get(k, \"(absent)\")}')
print()
if not c.get('cpid'):
    print('   PROBLEM: no cpid. The account has no clinician profile, so the queue')
    print('   has nothing to look up. The seed should have created one.')
elif c.get('vst') != 'verified':
    print(f'   PROBLEM: verification status is {c.get(\"vst\")!r}, not \'verified\'.')
    print('   An unverified clinician is refused by requireVerifiedClinician.')
"

echo
echo "── 3. Does the consultation service accept it directly?"
CODE=$(curl -s -o /tmp/_q.json -w '%{http_code}' \
  "http://localhost:4005/queue?scope=offered&limit=50" \
  -H "Authorization: Bearer $TOKEN")
echo "   HTTP $CODE"
echo "   body: $(head -c 300 /tmp/_q.json)"

echo
if [ "$CODE" = "200" ]; then
  echo "── VERDICT: the backend is fine. The proxy is not getting a token."
  echo
  echo "   That points at next-auth. Check that these agree — the JWT is encrypted"
  echo "   with NEXTAUTH_SECRET, so a mismatch between the value the app signed"
  echo "   with and the value it now reads with produces exactly this silence:"
  echo
  grep -H '^NEXTAUTH_SECRET=' "$ROOT/apps/doctor-admin/.env.local" 2>/dev/null | cut -c1-60
  echo
  echo "   If you regenerated NEXTAUTH_SECRET after signing in, the cookie in your"
  echo "   browser was signed with the old one. Sign out and in again, or clear"
  echo "   cookies for localhost:3100."
else
  echo "── VERDICT: the backend itself is refusing the token."
  echo "   The fix is in the token's contents or the service's guard, not in next-auth."
  echo "   The claims printed in step 2 say which."
fi
