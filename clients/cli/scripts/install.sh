#!/bin/sh

# Vultisig CLI Install Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

printf "${BLUE}🚀 Installing Vultisig CLI...${NC}\n"
printf "\n"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_DIR/bin"
BINARY_PATH="$BIN_DIR/vultisig"

# Check if binary exists
if [ ! -f "$BINARY_PATH" ]; then
    printf "${RED}❌ Binary not found at: $BINARY_PATH${NC}\n"
    printf "${YELLOW}💡 Run ./scripts/build-final.sh first${NC}\n"
    exit 1
fi

# Make sure the binary is executable
chmod +x "$BINARY_PATH"

# Detect shell and config file
SHELL_NAME=$(basename "$SHELL")
case "$SHELL_NAME" in
    zsh)
        SHELL_CONFIG="$HOME/.zshrc"
        ;;
    bash)
        if [ -f "$HOME/.bashrc" ]; then
            SHELL_CONFIG="$HOME/.bashrc"
        else
            SHELL_CONFIG="$HOME/.bash_profile"
        fi
        ;;
    fish)
        SHELL_CONFIG="$HOME/.config/fish/config.fish"
        ;;
    *)
        printf "${YELLOW}⚠️  Unknown shell: $SHELL_NAME${NC}\n"
        printf "${YELLOW}💡 Please manually add this to your shell config:${NC}\n"
        printf "   export PATH=\"$BIN_DIR:\$PATH\"\n"
        exit 1
        ;;
esac

# Check if already in PATH
PATH_EXPORT="export PATH=\"$BIN_DIR:\$PATH\""
if grep -q "$BIN_DIR" "$SHELL_CONFIG" 2>/dev/null; then
    printf "${GREEN}✅ Vultisig CLI is already in PATH${NC}\n"
    printf "${BLUE}ℹ️  Found in: $SHELL_CONFIG${NC}\n"
else
    # Add to PATH
    printf "${YELLOW}📝 Adding Vultisig CLI to PATH...${NC}\n"
    printf "\n" >> "$SHELL_CONFIG"
    printf "# Vultisig CLI\n" >> "$SHELL_CONFIG"
    printf "%s\n" "$PATH_EXPORT" >> "$SHELL_CONFIG"
    printf "${GREEN}✅ Added to: $SHELL_CONFIG${NC}\n"
fi

printf "\n"
printf "${GREEN}🎉 Installation successful!${NC}\n"
printf "\n"
printf "${BLUE}💡 To use Vultisig CLI in this terminal, run:${NC}\n"
printf "   source $SHELL_CONFIG\n"
printf "\n"
printf "${BLUE}💡 Or open a new terminal window${NC}\n"
printf "\n"
printf "${BLUE}💡 Example usage:${NC}\n"
printf "   vultisig init         # Initialize directories\n"
printf "   vultisig create       # Create a new vault\n"
printf "   vultisig list         # List keyshare files\n"
printf "   vultisig run          # Start daemon\n"
printf "   vultisig address      # Show addresses\n"