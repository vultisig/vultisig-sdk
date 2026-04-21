#!/usr/bin/env bash
# Pack @vultisig/sdk + @vultisig/walletcore-native into /tmp tgzs for local
# consumer testing (e.g. sdk-test-harness, vultiagent-app). Uses `yarn pack`
# so `workspace:*` protocol strings are rewritten to concrete versions —
# unlike `npm pack`, which leaves them intact and breaks consumer installs.
# See skills/common/dev-env-pitfalls.md items 13–14 for background.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

SDK_TGZ=/tmp/vultisig-sdk-poc.tgz
WC_TGZ=/tmp/vultisig-walletcore-native-poc.tgz

yarn workspace @vultisig/sdk pack --out "$SDK_TGZ"
yarn workspace @vultisig/walletcore-native pack --out "$WC_TGZ"

if tar -xzO -f "$SDK_TGZ" package/package.json | grep -qE 'workspace:'; then
  echo "ERROR: $SDK_TGZ still contains workspace: protocol strings" >&2
  exit 1
fi

echo "Packed $SDK_TGZ + $WC_TGZ"
