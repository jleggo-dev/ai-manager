#!/usr/bin/env bash
# The generated Swift activity map must match the TypeScript catalog.
#
# The name→HKWorkoutActivityType table used to exist by hand in three places. It is now generated
# from packages/cadence-shared/src/workout-activities.ts and compiled into BOTH native targets.
# This fails if the checked-in file is stale, so the catalog and the Swift cannot drift.
#
# Regenerate with: npm run gen:workout-activities
set -euo pipefail
cd "$(dirname "$0")/.."

GENERATED=apps/cadence-ios/ios/App/Shared/WorkoutActivityMap.swift
BEFORE="$(mktemp)"
trap 'rm -f "$BEFORE"' EXIT
cp "$GENERATED" "$BEFORE"

npm run --silent gen:workout-activities -w @cadence/shared >/dev/null

if ! diff -q "$BEFORE" "$GENERATED" >/dev/null; then
  echo "workout activities: $GENERATED is STALE." >&2
  echo "Run: npm run gen:workout-activities" >&2
  diff "$BEFORE" "$GENERATED" | head -30 >&2
  cp "$BEFORE" "$GENERATED"
  exit 1
fi
echo "workout activities: generated Swift matches the catalog"
