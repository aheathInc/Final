#!/usr/bin/env bash
#
# Writes a working .env for every service, on a fresh clone.
#
# .env files are gitignored (correctly — they hold secrets), so a clone has
# none. Two variables have no default and every service refuses to start
# without them: DATABASE_URL and JWT_SECRET.
#
# JWT_SECRET must be IDENTICAL across all services. They verify each other's
# tokens with one shared HS256 secret, so a per-service secret would mean a
# token minted by auth is rejected everywhere else — which surfaces as
# confusing 401s rather than as a configuration error.
#
# Existing .env files with real content are left alone. An EMPTY one is
# overwritten, because an empty .env is what caused this in the first place:
# my installers' `if [ ! -f .env ]` guard treated it as already configured.
#
# Run from the repo root:
#   bash setup-env-files.sh
#
set -euo pipefail

ROOT="$(pwd)"
[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }

DB_URL="${DATABASE_URL:-postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public}"

# Reuse an existing secret if any service already has one, so re-running this
# never invalidates sessions that are already working.
SECRET=""
for f in "$ROOT"/services/*/.env; do
  [ -f "$f" ] || continue
  found="$(grep -E '^JWT_SECRET=.{32,}' "$f" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [ -n "$found" ]; then SECRET="$found"; break; fi
done
if [ -z "$SECRET" ]; then
  SECRET="$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48)"
  echo "  generated a new shared JWT_SECRET"
else
  echo "  reusing the JWT_SECRET already present in the workspace"
fi

declare -A PORTS=(
  [auth]=4001 [patient]=4002 [doctor]=4003 [appointment]=4004
  [consultation]=4005 [messaging]=4006 [followup]=4007 [notification]=4008
  [ai]=4009 [emergency]=4010 [pharmacy]=4011 [payment]=4012
  [diagnostics]=4013 [quality]=4014 [families]=4015 [education]=4016
  [network]=4017 [insurance]=4018 [research]=4019 [surveillance]=4020
  [gateway]=4021 [sync]=4022 [devices]=4023 [prevention]=4024 [facilities]=4025
)

WROTE=0; KEPT=0; SKIPPED=0

for name in "${!PORTS[@]}"; do
  dir="$ROOT/services/$name"
  [ -f "$dir/package.json" ] || { SKIPPED=$((SKIPPED+1)); continue; }

  envfile="$dir/.env"
  if [ -s "$envfile" ] && grep -qE '^JWT_SECRET=.{32,}' "$envfile"; then
    KEPT=$((KEPT+1))
    continue
  fi

  {
    echo "NODE_ENV=development"
    echo "PORT=${PORTS[$name]}"
    echo "DATABASE_URL=$DB_URL"
    echo "JWT_SECRET=$SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"

    # Development-only conveniences, each refused in production by the
    # service's own env schema.
    case "$name" in
      auth)
        echo "OTP_ECHO_IN_RESPONSE=true"
        ;;
      notification)
        echo "SMS_PROVIDER=console"
        ;;
      ai)
        echo "CHAT_PROVIDER=stub"
        ;;
      gateway)
        echo "GATEWAY_SHARED_SECRET=dev-gateway-secret-change-me"
        echo "CONSULTATION_SERVICE_URL=http://localhost:4005"
        echo "MESSAGING_SERVICE_URL=http://localhost:4006"
        echo "FOLLOWUP_SERVICE_URL=http://localhost:4007"
        ;;
      sync)
        echo "CONSULTATION_SERVICE_URL=http://localhost:4005"
        echo "MESSAGING_SERVICE_URL=http://localhost:4006"
        echo "FOLLOWUP_SERVICE_URL=http://localhost:4007"
        echo "APPOINTMENT_SERVICE_URL=http://localhost:4004"
        ;;
      devices)
        echo "EMERGENCY_SERVICE_URL=http://localhost:4010"
        ;;
      prevention)
        echo "APPOINTMENT_SERVICE_URL=http://localhost:4004"
        ;;
      payment)
        echo "WEBHOOK_SECRET_MPESA=dev-secret-mpesa"
        echo "WEBHOOK_SECRET_TIGO_PESA=dev-secret-tigo"
        echo "WEBHOOK_SECRET_AIRTEL_MONEY=dev-secret-airtel"
        ;;
    esac
  } > "$envfile"
  WROTE=$((WROTE+1))
done

# Each web console needs its own NEXTAUTH_SECRET, which is unrelated to the
# services' shared JWT_SECRET: one signs a browser session, the other signs the
# tokens services exchange between themselves.
write_app_env() {
  local dir="$1" port="$2"
  [ -f "$ROOT/apps/$dir/package.json" ] || return 0

  local envfile="$ROOT/apps/$dir/.env.local"
  if [ -s "$envfile" ] && ! grep -q 'NEXTAUTH_SECRET=replace-me' "$envfile" \
     && grep -qE '^NEXTAUTH_SECRET=.{16,}' "$envfile"; then
    echo "  apps/$dir/.env.local already configured, left alone"
    return 0
  fi

  local secret
  secret="$(openssl rand -base64 32)"
  {
    echo "NEXTAUTH_SECRET=$secret"
    echo "NEXTAUTH_URL=http://localhost:$port"
    for name in auth patient doctor appointment consultation messaging followup \
                ai emergency pharmacy payment diagnostics quality families \
                education network insurance research surveillance sync devices \
                prevention facilities; do
      upper="$(echo "$name" | tr '[:lower:]' '[:upper:]')"
      echo "${upper}_SERVICE_URL=http://localhost:${PORTS[$name]}"
    done
  } > "$envfile"
  echo "  wrote apps/$dir/.env.local"
}

write_app_env doctor-admin 3100
write_app_env admin        3200
write_app_env analytics    3300

echo
echo "  services: wrote $WROTE, kept $KEPT already-configured, skipped $SKIPPED not-installed"
echo
echo "Next:"
echo "  export DATABASE_URL=\"$DB_URL\""
echo "  pnpm --filter @a-health/database exec prisma migrate deploy"
echo "  pnpm --filter @a-health/auth test"
