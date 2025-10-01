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
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_DIR/bin"
BINARY_PATH="$BIN_DIR/vultisig"

# Check if binary exists
if [ ! -f "$BINARY_PATH" ]; then
    echo -e "${RED}❌ Binary not found at: $BINARY_PATH${NC}"
    echo -e "${YELLOW}💡 Run ./scripts/build-final.sh first${NC}"
    exit 1
fi

# Detect shell and config file
SHELL_NAME=$(basename "$SHELL")
if [ "$SHELL_NAME" = "zsh" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
elif [ "$SHELL_NAME" = "bash" ]; then
    if [ -f "$HOME/.bashrc" ]; then
        SHELL_CONFIG="$HOME/.bashrc"
    else
        SHELL_CONFIG="$HOME/.bash_profile"
    fi
else
    echo -e "${YELLOW}⚠️  Unknown shell: $SHELL_NAME${NC}"
    echo -e "${YELLOW}💡 Please manually add this to your shell config:${NC}"
    echo -e "   export PATH=\"$BIN_DIR:\$PATH\""
    exit 1
fi

# Check if already in PATH
PATH_EXPORT="export PATH=\"$BIN_DIR:\$PATH\""
if grep -q "$BIN_DIR" "$SHELL_CONFIG" 2>/dev/null; then
    echo -e "${GREEN}✅ Vultisig CLI is already in PATH${NC}"
    echo -e "${BLUE}ℹ️  Found in: $SHELL_CONFIG${NC}"
else
    # Add to PATH
    echo -e "${YELLOW}📝 Adding Vultisig CLI to PATH...${NC}"
    echo "" >> "$SHELL_CONFIG"
    echo "# Vultisig CLI" >> "$SHELL_CONFIG"
    echo "$PATH_EXPORT" >> "$SHELL_CONFIG"
    echo -e "${GREEN}✅ Added to: $SHELL_CONFIG${NC}"
fi

echo ""
echo -e "${BLUE}📋 Verification:${NC}"

# Source the config and test
if [ -f "$SHELL_CONFIG" ]; then
    source "$SHELL_CONFIG"
fi

if command -v vultisig &> /dev/null; then
    vultisig --version
    echo ""
    echo -e "${GREEN}🎉 Installation successful!${NC}"
    echo ""
    echo -e "${BLUE}💡 To use immediately in this terminal:${NC}"
    echo -e "   source $SHELL_CONFIG"
    echo ""
    echo -e "${BLUE}💡 Example usage:${NC}"
    echo -e "   vultisig init         # Initialize directories"
    echo -e "   vultisig create       # Create a new vault"
    echo -e "   vultisig list         # List keyshare files"
    echo -e "   vultisig run          # Start daemon"
    echo -e "   vultisig address      # Show addresses"
else
    echo -e "${YELLOW}⚠️  Command not found yet in current shell${NC}"
    echo -e "${BLUE}💡 Run this to activate:${NC}"
    echo -e "   source $SHELL_CONFIG"
    echo -e "${BLUE}💡 Or open a new terminal${NC}"
fi