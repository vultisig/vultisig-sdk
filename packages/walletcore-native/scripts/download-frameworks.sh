#!/bin/bash
# Downloads prebuilt WalletCore XCFrameworks from TrustWallet GitHub releases

set -euo pipefail

VERSION="${1:-4.2.9}"
FRAMEWORKS_DIR="$(dirname "$0")/../ios/Frameworks"

mkdir -p "$FRAMEWORKS_DIR"

echo "Downloading WalletCore v${VERSION} XCFrameworks..."

# Download WalletCore.xcframework
WALLETCORE_URL="https://github.com/nicktomlin/wallet-core-fork/releases/download/${VERSION}/WalletCore.xcframework.zip"
echo "  -> WalletCore.xcframework"
curl -L -o "/tmp/WalletCore.xcframework.zip" "$WALLETCORE_URL"
rm -rf "$FRAMEWORKS_DIR/WalletCore.xcframework"
unzip -q -o "/tmp/WalletCore.xcframework.zip" -d "$FRAMEWORKS_DIR"
rm "/tmp/WalletCore.xcframework.zip"

# Download SwiftProtobuf.xcframework
PROTOBUF_URL="https://github.com/nicktomlin/wallet-core-fork/releases/download/${VERSION}/SwiftProtobuf.xcframework.zip"
echo "  -> SwiftProtobuf.xcframework"
curl -L -o "/tmp/SwiftProtobuf.xcframework.zip" "$PROTOBUF_URL"
rm -rf "$FRAMEWORKS_DIR/SwiftProtobuf.xcframework"
unzip -q -o "/tmp/SwiftProtobuf.xcframework.zip" -d "$FRAMEWORKS_DIR"
rm "/tmp/SwiftProtobuf.xcframework.zip"

echo "Done! Frameworks downloaded to $FRAMEWORKS_DIR"
ls -la "$FRAMEWORKS_DIR"
