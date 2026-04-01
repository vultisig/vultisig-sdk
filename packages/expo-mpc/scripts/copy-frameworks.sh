#!/bin/bash
# Copy Go MPC frameworks from vultiagent-app (or other sibling repos)
# Usage: bash scripts/copy-frameworks.sh [source_dir]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="${1:-$(dirname "$(dirname "$(dirname "$PACKAGE_DIR")")")/vultiagent-app/modules/expo-dkls}"

echo "Copying frameworks from: $SOURCE_DIR"

# iOS frameworks
if [ -d "$SOURCE_DIR/ios/Frameworks/godkls.xcframework" ]; then
  cp -R "$SOURCE_DIR/ios/Frameworks/godkls.xcframework" "$PACKAGE_DIR/ios/Frameworks/"
  echo "✓ godkls.xcframework"
else
  echo "✗ godkls.xcframework not found at $SOURCE_DIR/ios/Frameworks/"
fi

if [ -d "$SOURCE_DIR/ios/Frameworks/goschnorr.xcframework" ]; then
  cp -R "$SOURCE_DIR/ios/Frameworks/goschnorr.xcframework" "$PACKAGE_DIR/ios/Frameworks/"
  echo "✓ goschnorr.xcframework"
else
  echo "✗ goschnorr.xcframework not found at $SOURCE_DIR/ios/Frameworks/"
fi

# Android AARs
if [ -f "$SOURCE_DIR/android/libs/dkls-release.aar" ]; then
  cp "$SOURCE_DIR/android/libs/dkls-release.aar" "$PACKAGE_DIR/android/libs/"
  echo "✓ dkls-release.aar"
else
  echo "✗ dkls-release.aar not found at $SOURCE_DIR/android/libs/"
fi

if [ -f "$SOURCE_DIR/android/libs/goschnorr-release.aar" ]; then
  cp "$SOURCE_DIR/android/libs/goschnorr-release.aar" "$PACKAGE_DIR/android/libs/"
  echo "✓ goschnorr-release.aar"
else
  echo "✗ goschnorr-release.aar not found at $SOURCE_DIR/android/libs/"
fi

echo "Done."
