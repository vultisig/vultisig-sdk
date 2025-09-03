#!/bin/bash

# Vultisig CLI Install Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Installing Vultisig CLI...${NC}"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

BINARY_PATH="$PROJECT_DIR/bin/vultisig"
INSTALL_PATH="/usr/local/bin/vultisig"

# Check if binary exists
if [ ! -f "$BINARY_PATH" ]; then
    echo -e "${RED}❌ Binary not found at: $BINARY_PATH${NC}"
    echo -e "${YELLOW}💡 Run ./scripts/build.sh first${NC}"
    exit 1
fi

# Check if /usr/local/bin exists
if [ ! -d "/usr/local/bin" ]; then
    echo -e "${YELLOW}📁 Creating /usr/local/bin directory...${NC}"
    sudo mkdir -p "/usr/local/bin"
fi

# Check if already installed
if [ -f "$INSTALL_PATH" ]; then
    echo -e "${YELLOW}⚠️  Vultisig is already installed${NC}"
    read -p "Overwrite existing installation? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}ℹ️  Installation cancelled${NC}"
        exit 0
    fi
fi

# Install the binary
echo -e "${YELLOW}📦 Copying binary to system PATH...${NC}"
sudo cp "$BINARY_PATH" "$INSTALL_PATH"

# Verify installation
if [ -f "$INSTALL_PATH" ] && [ -x "$INSTALL_PATH" ]; then
    echo -e "${GREEN}✅ Vultisig CLI installed successfully!${NC}"
    echo ""
    echo -e "${BLUE}📋 Verification:${NC}"
    vultisig --version
    echo ""
    echo -e "${GREEN}🎉 You can now use 'vultisig' from anywhere!${NC}"
    echo ""
    echo -e "${BLUE}💡 Example usage:${NC}"
    echo -e "   vultisig init      # Initialize directories"
    echo -e "   vultisig list      # List keyshare files"
    echo -e "   vultisig run       # Start daemon"
    echo -e "   vultisig address   # Show addresses"
else
    echo -e "${RED}❌ Installation failed${NC}"
    exit 1
fi