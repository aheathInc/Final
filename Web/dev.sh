#!/usr/bin/env bash
#
# Starts everything the clinician queue needs, in one terminal.
#
# Only five backend processes are involved, not all twenty-five services: auth
# for signing in, consultation for the queue itself, doctor for the availability
# toggle, messaging for care-thread conversations, and the dashboard. The rest
# are not needed until there are screens that use them.
#
# Ctrl+C stops all of them together — the trap below is what makes that work,
# and without it the background services would survive and you would hit
# EADDRINUSE on the next run.
#
# Usage, from the repo root:
#   bash dev.sh
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
  echo "Stopping services..."
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "Stopped."
}
trap cleanup EXIT INT TERM

port_free() {
  ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

wait_for_port() {
  local port="$1" name="$2" tries=0
  until ! port_free "$port"; do
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      echo "  $name did not come up on port $port after 30s."
      echo "  Its log: $LOGS/$name.log"
      tail -20 "$LOGS/$name.log" 2>/dev/null || true
      exit 1
    fi
    sleep 0.5
  done
}

start() {
  local pkg="$1" port="$2" name="$3"

  if ! port_free "$port"; then
    # Something is already there. Almost always a previous run that was not
    # stopped cleanly, so say what to do rather than silently continuing and
    # letting the app talk to a stale process.
    echo "  port $port is already in use ($name)."
    echo "  Stop it first:  fuser -k $port/tcp"
    exit 1
  fi

  echo "  starting $name on $port..."
  pnpm --filter "$pkg" dev > "$LOGS/$name.log" 2>&1 &
  PIDS+=($!)
  wait_for_port "$port" "$name"
  echo "  $name ready"
}

# --- preflight -------------------------------------------------------------
echo "Checking Postgres..."
if port_free 5432; then
  echo "  nothing listening on 5432."
  echo "  Start it:  sudo systemctl start postgresql"
  exit 1
fi
echo "  Postgres reachable"

for svc in auth consultation doctor messaging; do
  if [ ! -s "$ROOT/services/$svc/.env" ]; then
    echo "  services/$svc/.env is missing or empty. Run: bash setup-env-files.sh"
    exit 1
  fi
done

if [ ! -s "$ROOT/apps/doctor-admin/.env.local" ]; then
  echo "  apps/doctor-admin/.env.local is missing. Run: bash setup-env-files.sh"
  exit 1
fi
echo "  env files present"
echo

# --- services --------------------------------------------------------------
echo "Starting backend services (logs in .dev-logs/)..."
start "@a-health/auth" 4001 auth
start "@a-health/consultation" 4005 consultation
start "@a-health/doctor" 4003 doctor
start "@a-health/messaging" 4006 messaging

echo
echo "-------------------------------------------------------------"
echo "  Dashboard:  http://localhost:3100"
echo "  Sign in:    daktari@dev.local  /  Daktari#2026"
echo
echo "  Ctrl+C stops everything."
echo "-------------------------------------------------------------"
echo

# The dashboard runs in the foreground so its output is what you watch.
pnpm --filter doctor-dashboard dev
