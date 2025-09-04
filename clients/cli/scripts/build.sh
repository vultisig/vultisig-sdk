#!/bin/bash

# Vultisig CLI Build Script
set -e

echo "🏗️  Building Vultisig CLI..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}📁 Project directory: ${PROJECT_DIR}${NC}"

# Clean previous builds
echo -e "${YELLOW}🧹 Cleaning previous builds...${NC}"
rm -rf "$PROJECT_DIR/dist"
rm -rf "$PROJECT_DIR/bin"
mkdir -p "$PROJECT_DIR/bin"

# Build TypeScript
echo -e "${YELLOW}🔨 Compiling TypeScript...${NC}"
cd "$PROJECT_DIR"
npx tsc

if [ ! -f "$PROJECT_DIR/dist/clients/cli-ts/src/cli.js" ]; then
    echo -e "${RED}❌ TypeScript compilation failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ TypeScript compilation successful${NC}"

# Create temporary build directory
BUILD_DIR="/tmp/vultisig-cli-build"
echo -e "${YELLOW}📦 Creating build package...${NC}"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Copy compiled files with correct structure
cp -r "$PROJECT_DIR/dist/clients/cli-ts/src/"* "$BUILD_DIR/"
cp -r "$PROJECT_DIR/dist/core" "$BUILD_DIR/"
cp -r "$PROJECT_DIR/dist/lib" "$BUILD_DIR/"

# Copy package.json and install production dependencies
cp "$PROJECT_DIR/package.json" "$BUILD_DIR/"
cd "$BUILD_DIR"

# Install production dependencies only
echo -e "${YELLOW}📥 Installing production dependencies...${NC}"
npm install --production --silent

# Fix imports for pkg compatibility
echo -e "${YELLOW}🔧 Fixing imports for pkg compatibility...${NC}"
node "$PROJECT_DIR/scripts/fix-imports.js" "$BUILD_DIR"

# Install pkg locally for building
npm install pkg --no-save --silent

# Create the binary
echo -e "${YELLOW}⚙️  Creating standalone binary...${NC}"
echo -e "${BLUE}   This may take a moment to download Node.js runtime...${NC}"

# Detect platform
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case $ARCH in
    x86_64) ARCH="x64" ;;
    arm64) ARCH="arm64" ;;
    aarch64) ARCH="arm64" ;;
esac

TARGET="node18-${PLATFORM}-${ARCH}"
echo -e "${BLUE}   Building for: ${TARGET}${NC}"

npx pkg cli.js --targets "$TARGET" --out-path "$PROJECT_DIR/bin"

if [ ! -f "$PROJECT_DIR/bin/cli" ]; then
    echo -e "${RED}❌ Binary creation failed${NC}"
    exit 1
fi

# Rename binary to vultisig
mv "$PROJECT_DIR/bin/cli" "$PROJECT_DIR/bin/vultisig"

# Make executable
chmod +x "$PROJECT_DIR/bin/vultisig"

# Clean up temp directory
rm -rf "$BUILD_DIR"

echo -e "${GREEN}🎉 Build completed successfully!${NC}"
echo -e "${GREEN}📍 Binary created at: ${PROJECT_DIR}/bin/vultisig${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo -e "   1. Test: ${PROJECT_DIR}/bin/vultisig --help"
echo -e "   2. Install: sudo cp ${PROJECT_DIR}/bin/vultisig /usr/local/bin/"
echo -e "   3. Use: vultisig list"
echo ""
echo -e "${YELLOW}💡 Run ./scripts/install.sh to install to system PATH${NC}"