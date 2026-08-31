#!/usr/bin/env bash
# Interval engine parity: IntervalEngine.swift vs interval.ts, pinned to one fixture.
#
# IntervalEngine.swift is a hand port marked KEEP IN LOCKSTEP. This is what enforces it. A drift
# is a correctness bug, not a style one: the phone and the watch would count a session differently,
# and whichever wrote the log would decide what happened. It caught a real one on its first run
# (the port had renamed the phase labels).
#
# macOS only — skips cleanly elsewhere so a Linux CI leg does not fail on a missing toolchain.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v swiftc >/dev/null 2>&1; then
  echo "interval parity: swiftc not available, skipping (macOS only)"
  exit 0
fi

OUT="$(mktemp -d)/parity"
trap 'rm -rf "$(dirname "$OUT")"' EXIT

swiftc -O -o "$OUT" \
  apps/cadence-ios/ios/App/CadenceWatch/Tests/IntervalParityCheck.swift \
  apps/cadence-ios/ios/App/CadenceWatch/IntervalEngine.swift

"$OUT" packages/cadence-shared/interval-parity.json
