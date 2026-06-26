#!/usr/bin/env bash
#
# Starts dev servers, waits for them to be ready, runs E2E tests, then cleans up.
# Usage: ./scripts/run-e2e.sh

set -euo pipefail

FRONTEND_PORT=5173
BACKEND_PORT=3001
FRONTEND_PID=""
BACKEND_PID=""

cleanup() {
  echo "[e2e] Shutting down servers..."
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "[e2e] Done."
}
trap cleanup EXIT

wait_for_port() {
  local port=$1
  local name=$2
  local attempts=0
  local max=30
  echo "[e2e] Waiting for $name on port $port..."
  while ! curl -s -o /dev/null "http://localhost:$port" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "$max" ]; then
      echo "[e2e] ERROR: $name did not start on port $port after ${max}s"
      exit 1
    fi
    sleep 1
  done
  echo "[e2e] $name is ready."
}

already_running() {
  curl -s -o /dev/null "http://localhost:$1" 2>/dev/null
}

if already_running $FRONTEND_PORT && already_running $BACKEND_PORT; then
  echo "[e2e] Dev servers already running, skipping startup."
else
  echo "[e2e] Starting backend..."
  npm run dev:backend > /dev/null 2>&1 &
  BACKEND_PID=$!

  echo "[e2e] Starting frontend..."
  npm run dev:frontend > /dev/null 2>&1 &
  FRONTEND_PID=$!

  wait_for_port $BACKEND_PORT "backend"
  wait_for_port $FRONTEND_PORT "frontend"
fi

echo "[e2e] Running Puppeteer E2E tests..."
npx vitest run --config e2e/vitest.config.ts --reporter=verbose
