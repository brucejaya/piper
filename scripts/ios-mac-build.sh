#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT_DIR/apps/ios"
DESTINATION="${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 15}"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required. Install it with: brew install xcodegen" >&2
  exit 1
fi

cd "$IOS_DIR"
xcodegen generate
xcodebuild test \
  -project Piper.xcodeproj \
  -scheme Piper \
  -destination "$DESTINATION"
