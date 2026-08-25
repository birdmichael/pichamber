#!/usr/bin/env bash
# Fail a signed Mac desktop package that is not Developer ID + hardened runtime
# + stapled notarization + the Electron JIT entitlements.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="${1:-packages/electron/dist}"
EXPECTED_TEAM="${APPLE_TEAM_ID:-XD3JQBK82H}"

APP_DIR="$DIST_DIR/mac"
if [[ -d "$DIST_DIR/mac-arm64" ]]; then
  APP_DIR="$DIST_DIR/mac-arm64"
fi

APP_PATH="$(find "$APP_DIR" -maxdepth 2 -name '*.app' -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  echo "Error: .app not found under $DIST_DIR/mac*" >&2
  ls -la "$DIST_DIR" >&2 || true
  exit 1
fi

echo "Verifying $APP_PATH"
codesign -vv --deep --strict "$APP_PATH"

CS_INFO="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)"
echo "$CS_INFO"
printf '%s\n' "$CS_INFO" | node "$SCRIPT_DIR/macos-signing.mjs" assert-codesign --team "$EXPECTED_TEAM"

xcrun stapler validate "$APP_PATH"

ENTITLEMENTS="$(codesign -d --entitlements :- "$APP_PATH" 2>&1 || true)"
printf '%s\n' "$ENTITLEMENTS" | node "$SCRIPT_DIR/macos-signing.mjs" assert-entitlements
