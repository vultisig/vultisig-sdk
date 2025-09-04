#!/bin/bash

# Vultisig CLI - Build and Install Script
# This script builds the vultisig binary and installs it to your system PATH

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Vultisig CLI - Build and Install${NC}"
echo ""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Build the binary
echo -e "${YELLOW}🏗️  Building vultisig binary...${NC}"
if [ -f "./scripts/build.sh" ]; then
    ./scripts/build.sh
else
    echo -e "${RED}❌ Build script not found${NC}"
    exit 1
fi

# Check if binary was created
if [ ! -f "bin/vultisig" ]; then
    echo -e "${RED}❌ Binary not created${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Binary built successfully!${NC}"

# Install to system PATH
echo -e "${YELLOW}📦 Installing to system PATH...${NC}"

# Create /usr/local/bin if it doesn't exist
if [ ! -d "/usr/local/bin" ]; then
    echo -e "${YELLOW}📁 Creating /usr/local/bin directory...${NC}"
    sudo mkdir -p /usr/local/bin
fi

# Copy binary
sudo cp bin/vultisig /usr/local/bin/vultisig
sudo chmod +x /usr/local/bin/vultisig

# Verify installation
if command -v vultisig >/dev/null 2>&1; then
    echo -e "${GREEN}🎉 Vultisig CLI installed successfully!${NC}"
    echo ""
    echo -e "${BLUE}📋 Verification:${NC}"
    vultisig --version
    echo ""
    echo -e "${GREEN}✅ You can now use 'vultisig' from anywhere!${NC}"
    echo ""
    echo -e "${BLUE}💡 Quick start:${NC}"
    echo -e "   vultisig init      # Initialize directories"
    echo -e "   vultisig list      # List keyshare files" 
    echo -e "   vultisig run       # Start daemon"
    echo -e "   vultisig address   # Show addresses"
    echo ""
    echo -e "${YELLOW}📁 Put your .vult files in the 'keyshares/' directory${NC}"
else
    echo -e "${RED}❌ Installation verification failed${NC}"
    exit 1
fi