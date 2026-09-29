#!/usr/bin/env bash
#
# Starts one or more web consoles together with exactly the services they need.
#
#   bash dev-web.sh web          -> unified staff console (3000)
#   bash dev-web.sh doctor       -> clinician console  (3100)
#   bash dev-web.sh admin        -> operations console (3200)
#   bash dev-web.sh analytics    -> analytics portal   (3300)
#   bash dev-web.sh doctor admin -> both, services shared
#   bash dev-web.sh all          -> all four consoles
#
# Only the services a chosen console actually calls are started. Running all
# services is a lot of memory for screens you are not looking at.
#
# Ctrl+C stops everything. Without that trap the background services survive
# and the next run fails with EADDRINUSE.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }

LOGS="$ROOT/.dev-logs"
mkdir -p "$LOGS"
PIDS=()

cleanup() {
  echo
  echo "Stopping..."
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  echo "Stopped."
}
trap cleanup EXIT INT TERM

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# name:port for every service any console might need
declare -A PORT=(
  [auth]=4001 [patient]=4002 [doctor]=4003 [appointment]=4004
  [consultation]=4005 [messaging]=4006 [followup]=4007
  [ai]=4009 [emergency]=4010 [pharmacy]=4011 [payment]=4012
  [diagnostics]=4013 [quality]=4014 [families]=4015 [education]=4016
  [network]=4017 [research]=4019 [surveillance]=4020
  [devices]=4023 [prevention]=4024 [facilities]=4025
)

DOCTOR_SVCS="auth patient doctor appointment consultation messaging followup ai pharmacy diagnostics families education network prevention"
ADMIN_SVCS="auth doctor emergency payment quality devices facilities"
ANALYTICS_SVCS="auth research surveillance"

APPS=("$@")
[ ${#APPS[@]} -eq 0 ] && APPS=(web)
if [ "${APPS[0]}" = "all" ]; then APPS=(web doctor admin analytics); fi

WANTED=""
RUN_WEB=0; RUN_DOCTOR=0; RUN_ADMIN=0; RUN_ANALYTICS=0
for app in "${APPS[@]}"; do
  case "$app" in
    web)       WANTED="$WANTED $DOCTOR_SVCS emergency payment quality devices facilities research surveillance"; RUN_WEB=1 ;;
    doctor)    WANTED="$WANTED $DOCTOR_SVCS";    RUN_DOCTOR=1 ;;
    admin)     WANTED="$WANTED $ADMIN_SVCS";     RUN_ADMIN=1 ;;
    analytics) WANTED="$WANTED $ANALYTICS_SVCS"; RUN_ANALYTICS=1 ;;
    *) echo "Unknown app: $app  (use web, doctor, admin, analytics, or all)"; exit 1 ;;
  esac
done
SERVICES=$(echo "$WANTED" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')

# --- preflight -------------------------------------------------------------
if port_free 5432; then
  echo "Postgres is not running.  sudo systemctl start postgresql"
  exit 1
fi

for svc in $SERVICES; do
  if [ ! -s "$ROOT/services/$svc/.env" ]; then
    echo "services/$svc/.env missing or empty.  Run: bash setup-env-files.sh"
    exit 1
  fi
done

check_app_env() {
  local dir="$1" name="$2"
  if [ ! -s "$ROOT/apps/$dir/.env.local" ]; then
    echo "apps/$dir/.env.local is missing."
    echo "  cp apps/$dir/.env.local.example apps/$dir/.env.local"
    echo "  then put a real value in NEXTAUTH_SECRET:  openssl rand -base64 32"
    exit 1
  fi
  if grep -q 'NEXTAUTH_SECRET=replace-me' "$ROOT/apps/$dir/.env.local"; then
    # next-auth fails to sign the session with the placeholder, and the symptom
    # is a login that silently does nothing — worth catching here instead.
    echo "apps/$dir/.env.local still has NEXTAUTH_SECRET=replace-me ($name)."
    echo "  Generate one:  openssl rand -base64 32"
    exit 1
  fi
}
[ $RUN_DOCTOR -eq 1 ]    && check_app_env doctor-admin "clinician console"
[ $RUN_ADMIN -eq 1 ]     && check_app_env admin        "operations console"
[ $RUN_ANALYTICS -eq 1 ] && check_app_env analytics    "analytics portal"
[ $RUN_WEB -eq 1 ]       && check_app_env web          "unified staff console"

echo "Starting $(echo "$SERVICES" | wc -w) service(s). Logs in .dev-logs/"

start_service() {
  local name="$1" port="${PORT[$1]}"
  if ! port_free "$port"; then
    echo "  port $port already in use ($name).  Stop it:  fuser -k $port/tcp"
    exit 1
  fi
  pnpm --filter "@a-health/$name" dev > "$LOGS/$name.log" 2>&1 &
  PIDS+=($!)
}

for svc in $SERVICES; do start_service "$svc"; done

# Wait for them together rather than one at a time — they start in parallel,
# so serialising the waits would add up to nothing but delay.
echo -n "  waiting"
for svc in $SERVICES; do
  tries=0
  until ! port_free "${PORT[$svc]}"; do
    tries=$((tries + 1))
    if [ $tries -gt 80 ]; then
      echo
      echo "  $svc did not start. Last lines of $LOGS/$svc.log:"
      tail -15 "$LOGS/$svc.log" 2>/dev/null || true
      exit 1
    fi
    sleep 0.5
  done
  echo -n "."
done
echo " ready"

start_app() {
  local pkg="$1" port="$2" label="$3"
  if ! port_free "$port"; then
    echo "  port $port already in use ($label).  Stop it:  fuser -k $port/tcp"
    exit 1
  fi
  pnpm --filter "$pkg" dev > "$LOGS/$label.log" 2>&1 &
  PIDS+=($!)
}

echo
echo "-------------------------------------------------------------"
if [ $RUN_DOCTOR -eq 1 ]; then
  start_app doctor-dashboard 3100 doctor-dashboard
  echo "  Clinician    http://localhost:3100   daktari@dev.local / Daktari#2026"
fi
if [ $RUN_WEB -eq 1 ]; then
  start_app a-health-web 3000 unified-web
  echo "  Unified staff http://localhost:3000"
fi
if [ $RUN_ADMIN -eq 1 ]; then
  start_app admin-console 3200 admin-console
  echo "  Operations   http://localhost:3200   msimamizi@dev.local / Msimamizi#2026"
fi
if [ $RUN_ANALYTICS -eq 1 ]; then
  start_app analytics-portal 3300 analytics-portal
  echo "  Analytics    http://localhost:3300   msimamizi@dev.local / Msimamizi#2026"
fi
echo
echo "  Ctrl+C stops everything."
echo "-------------------------------------------------------------"
echo

# Nothing to run in the foreground, so wait on the children and let the trap
# do the cleanup when the terminal is interrupted.
wait
