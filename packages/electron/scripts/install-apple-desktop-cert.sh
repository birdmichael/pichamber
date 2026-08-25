#!/usr/bin/env bash
# Import APPLE_CERTIFICATE (base64 PKCS#12) into a temporary keychain and pin
# electron-builder to that Developer ID Application identity via CSC_NAME.
#
# Do not export CSC_LINK / CSC_KEY_PASSWORD. electron-builder 26 re-imports the
# p12 into a second keychain, and writing the password through GITHUB_ENV can
# corrupt it (`MAC verification failed during PKCS12 import`).
# Do not export `Developer ID Application: ...` as CSC_NAME; electron-builder 26
# rejects that prefix. Use the stripped certificate name.
# Do not set CSC_KEYCHAIN or replace the user keychain search list — that hides
# identities electron-builder still needs to see.
set -euo pipefail

if [[ -z "${APPLE_CERTIFICATE:-}" ]]; then
  echo "APPLE_CERTIFICATE is required for signed Mac desktop builds." >&2
  exit 1
fi
if [[ -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]]; then
  echo "APPLE_CERTIFICATE_PASSWORD is required for signed Mac desktop builds." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER_TEMP="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
KEYCHAIN_PATH="${KEYCHAIN_PATH:-$RUNNER_TEMP/electron-signing.keychain-db}"
CERT_PATH="${CERT_PATH:-$RUNNER_TEMP/certificate.p12}"
KEYCHAIN_PASSWORD="${KEYCHAIN_PASSWORD:-$(openssl rand -base64 32)}"

if [[ -f "$KEYCHAIN_PATH" ]]; then
  security delete-keychain "$KEYCHAIN_PATH" || true
fi

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

# Keep a trailing newline so Apple's base64 decoder accepts the secret as stored.
echo "$APPLE_CERTIFICATE" | base64 --decode > "$CERT_PATH"
# Import the full PKCS#12 (leaf + intermediates + private key). Do not pass
# `-t cert`; that can drop the private key on some runners.
security import "$CERT_PATH" \
  -P "$APPLE_CERTIFICATE_PASSWORD" \
  -A -T /usr/bin/codesign -f pkcs12 \
  -k "$KEYCHAIN_PATH" >/dev/null
rm -f "$CERT_PATH"

security list-keychain -d user -s "$KEYCHAIN_PATH" \
  "$HOME/Library/Keychains/login.keychain-db"
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

IDENTITY="$(
  security find-identity -v -p codesigning "$KEYCHAIN_PATH" \
    | node "$SCRIPT_DIR/macos-signing.mjs" pick-identity
)"
CSC_NAME="$(
  printf '%s\n' "$IDENTITY" \
    | node "$SCRIPT_DIR/macos-signing.mjs" csc-name
)"
echo "Using codesigning identity: $IDENTITY"
echo "Using electron-builder CSC_NAME: $CSC_NAME"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "csc_name=$CSC_NAME" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "CSC_NAME=$CSC_NAME" >> "$GITHUB_ENV"
fi
