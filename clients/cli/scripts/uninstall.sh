#!/bin/bash

# Vultisig CLI Uninstall Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🗑️  Uninstalling Vultisig CLI...${NC}"

INSTALL_PATH="/usr/local/bin/vultisig"

# Check if installed
if [ ! -f "$INSTALL_PATH" ]; then
    echo -e "${YELLOW}ℹ️  Vultisig CLI is not installed${NC}"
    exit 0
fi

# Confirm uninstall
read -p "Are you sure you want to uninstall Vultisig CLI? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}ℹ️  Uninstall cancelled${NC}"
    exit 0
fi

# Remove the binary
echo -e "${YELLOW}🗑️  Removing binary from system PATH...${NC}"
sudo rm -f "$INSTALL_PATH"

# Verify removal
if [ ! -f "$INSTALL_PATH" ]; then
    echo -e "${GREEN}✅ Vultisig CLI uninstalled successfully!${NC}"
    echo ""
    echo -e "${BLUE}ℹ️  Note: Your keyshares and configuration files remain intact${NC}"
    echo -e "   Config: ~/.vultisig/"
    echo -e "   Keyshares: ./keyshares/ (in your project directories)"
else
    echo -e "${RED}❌ Uninstall failed${NC}"
    exit 1
fi