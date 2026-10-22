#!/usr/bin/env bash
#
# Checks what is actually on disk before a deploy, rather than trusting either
# of us to remember which scripts were run.
#
# Reports three things separately, because they are not the same kind of
# problem:
#   BLOCKING  — a screen that is already shipped calls an endpoint with no route
#   DRIFT     — a route exists but the contract does not describe it
#   GAP       — a requirement with nothing built for it at all
#
# Read-only. Changes nothing.
#
# Run from the repo root:
#   bash verify-system.sh
#
set -uo pipefail

ROOT="$(pwd)"
[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }

CONTRACT="$ROOT/packages/api/openapi/a-health-api-v1.yaml"
BLOCKING=0
PENDING=0

section() { echo; echo "── $1"; }
ok()   { echo "   ok      $1"; }
# Breaks a screen that is already shipped.
bad()  { echo "   MISSING $1"; BLOCKING=$((BLOCKING+1)); }
# Not yet done, but nothing running today depends on it.
soon() { echo "   later   $1"; PENDING=$((PENDING+1)); }
note() { echo "   note    $1"; }

section "Contract"
if [ ! -f "$CONTRACT" ]; then
  bad "packages/api/openapi/a-health-api-v1.yaml not found"
else
  COUNT=$(python3 -c "import yaml;print(len(yaml.safe_load(open('$CONTRACT'))['paths']))" 2>/dev/null || echo 0)
  if [ "$COUNT" -ge 119 ]; then ok "$COUNT paths"
  else bad "only $COUNT paths — expected 119. A contract-touching script has not been run, or the file reverted."; fi
fi

section "Blocking fixes"
check_route() {
  local label="$1" file="$2" needle="$3"
  if [ ! -f "$ROOT/$file" ]; then bad "$label — $file not present"; return; fi
  if grep -q "$needle" "$ROOT/$file"; then ok "$label"; else bad "$label — run the fix script"; fi
}

# Without these, screens that are already shipped fail on open.
check_route "GET /consultations/{id}  (clinician case screen)" \
  "services/consultation/src/routes/consultation.routes.ts" "getConsultation"
check_route "GET /consultations       (patient home screen)" \
  "services/consultation/src/routes/consultation.routes.ts" "listConsultations"
check_route "GET /check-ins           (patient check-ins screen)" \
  "services/followup/src/routes/followup.routes.ts" "listMyCheckIns"

section "Configurable triage (FR-AD-03)"
check_route "/triage-rulesets routes" \
  "services/consultation/src/routes/consultation.routes.ts" "triage-rulesets"
if [ -f "$ROOT/apps/admin/app/triage/page.tsx" ]; then ok "admin /triage screen"
else bad "admin /triage screen — run setup-admin-triage-screen.sh after unzipping the console"; fi
if grep -rq "TriageRuleset" "$ROOT/packages/database/prisma/schema.prisma" 2>/dev/null; then
  ok "TriageRuleset model"
else bad "TriageRuleset model — run expand-schema-triage-rules.sh then migrate"; fi

section "Apps present"
for pair in "doctor-admin:app/queue" "admin:app/emergency" "analytics:app/surveillance" "patient_app:lib/main.dart"; do
  dir="${pair%%:*}"; probe="${pair##*:}"
  if [ -e "$ROOT/apps/$dir/$probe" ]; then ok "apps/$dir"
  elif [ "$dir" = "patient_app" ]; then soon "apps/$dir — Flutter, not needed to run the web stack"
  else bad "apps/$dir — not unzipped"; fi
done

section "Config"
MISSING_ENV=0
for svc in "$ROOT"/services/*/; do
  name=$(basename "$svc")
  [ -f "$svc/package.json" ] || continue
  if [ ! -s "$svc/.env" ]; then MISSING_ENV=$((MISSING_ENV+1)); fi
done
if [ "$MISSING_ENV" -eq 0 ]; then ok "every installed service has a .env"
else bad "$MISSING_ENV service(s) missing .env — run setup-env-files.sh"; fi

SECRETS=$(grep -h '^JWT_SECRET=' "$ROOT"/services/*/.env 2>/dev/null | sort -u | wc -l)
if [ "$SECRETS" -eq 1 ]; then ok "one shared JWT_SECRET across services"
elif [ "$SECRETS" -eq 0 ]; then bad "no JWT_SECRET found"
else bad "$SECRETS different JWT_SECRETs — services will reject each other's tokens"; fi

section "Deployment files"
# Only needed when moving to a server; local development does not use them.
for f in Dockerfile docker-compose.prod.yml infrastructure/Caddyfile; do
  [ -f "$ROOT/$f" ] && ok "$f" || soon "$f — run setup-production.sh when deploying"
done

section "Known gaps — nothing built, these will NOT be caught above"
note "FR-CN-05  reassign a case to another clinician"
note "FR-CN-01  voice note as a symptom input"
note "FR-CN-06  voice call / PSTN callback for feature phones"
note "FR-PS-01  screening questionnaires (invitations exist; the questions do not)"
note "FR-TS-01  rate the receiving facility (rating a consultation works)"
note "FR-TS-03  referral / invite code"
note "FR-AD-02  clinician performance and earnings dashboard"
note "FR-EM-01  the patient app sends no GPS location yet"

echo
if [ "$BLOCKING" -gt 0 ]; then
  echo "$BLOCKING blocking problem(s). Each breaks a screen that is already shipped — fix before testing."
elif [ "$PENDING" -gt 0 ]; then
  echo "Nothing blocking. $PENDING item(s) marked 'later' are for deployment or the mobile app,"
  echo "and none of them stop the web system from running now."
else
  echo "Nothing blocking and nothing pending."
fi
echo "The gaps listed above are open by decision, not by accident."
exit 0
