#!/usr/bin/env bash
# Copy prebuilt DKLS / Schnorr Android archives from the vultisig-android app into the SDK.
# Default source: sibling checkout ../android (override with ANDROID_APP_LIBS=/path/to/app/libs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ANDROID_APP_LIBS:-$ROOT/../android/app/libs}"
DST="$ROOT/packages/mpc-native/android/libs"
for f in dkls-release.aar goschnorr-release.aar; do
  if [[ ! -f "$SRC/$f" ]]; then
    echo "missing: $SRC/$f" >&2
    echo "Set ANDROID_APP_LIBS to the directory that contains dkls-release.aar and goschnorr-release.aar." >&2
    exit 1
  fi
  cp "$SRC/$f" "$DST/$f"
  echo "copied $f"
done
echo "Done. Commit $DST/*.aar when versions change."
