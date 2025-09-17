#!/bin/bash

# Directory sync script for vultisig-sdk
# This script syncs specific directories from the vultisig-windows repository

set -e

REPO_URL="https://github.com/vultisig/vultisig-windows.git"
BRANCH="main"
TEMP_DIR="/tmp/vultisig-windows-sync"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  sync        Sync both core/ and lib/ directories"
    echo "  sync-core   Sync only core/ directory"
    echo "  sync-lib    Sync only lib/ directory"
    echo "  status      Show current directory status"
    echo "  help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 sync          # Sync both directories"
    echo "  $0 sync-core     # Sync only core/"
    echo "  $0 status        # Check directory status"
}

# Function to backup existing directories
backup_directory() {
    local dir_name=$1
    if [ -d "$PROJECT_ROOT/$dir_name" ]; then
        local backup_name="archived/${dir_name}-backup-$(date +%Y%m%d-%H%M%S)"
        print_status $YELLOW "📦 Backing up existing $dir_name/ to $backup_name/"
        mkdir -p "$PROJECT_ROOT/archived"
        cp -r "$PROJECT_ROOT/$dir_name" "$PROJECT_ROOT/$backup_name"
    fi
}

# Function to sync a directory
sync_directory() {
    local dir_name=$1
    print_status $BLUE "🔄 Syncing $dir_name/ directory from vultisig-windows..."
    
    cd "$PROJECT_ROOT"
    
    # Create temporary directory
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR"
    
    # Clone with sparse checkout
    print_status $BLUE "📥 Cloning repository with sparse checkout..."
    git clone --filter=blob:none --sparse "$REPO_URL" .
    git sparse-checkout set "$dir_name"
    
    # Check if the directory exists in the remote
    if [ ! -d "$dir_name" ]; then
        print_status $RED "❌ Directory $dir_name/ not found in remote repository"
        rm -rf "$TEMP_DIR"
        return 1
    fi
    
    # Backup existing directory
    backup_directory "$dir_name"
    
    # Copy the directory to project root
    print_status $BLUE "📋 Copying $dir_name/ to project..."
    rm -rf "$PROJECT_ROOT/$dir_name"
    cp -r "$dir_name" "$PROJECT_ROOT/"
    
    # Clean up
    rm -rf "$TEMP_DIR"
    
    print_status $GREEN "✅ Successfully synced $dir_name/ directory"
    
    # Show recent changes
    cd "$PROJECT_ROOT"
    if [ -d "$dir_name" ]; then
        print_status $YELLOW "📊 Directory contents:"
        find "$dir_name" -name "package.json" | head -5
        echo ""
    fi
}

# Function to show directory status
show_status() {
    cd "$PROJECT_ROOT"
    
    print_status $BLUE "📊 Directory Status Report"
    echo "=========================="
    
    for dir_name in "core" "lib"; do
        if [ -d "$dir_name" ]; then
            print_status $GREEN "✅ $dir_name/ directory exists"
            local package_count=$(find "$dir_name" -name "package.json" | wc -l | tr -d ' ')
            echo "   Contains $package_count package.json files"
            
            # Show some key files
            if [ -d "$dir_name" ]; then
                echo "   Key subdirectories:"
                ls -1 "$dir_name" | head -5 | sed 's/^/   - /'
            fi
        else
            print_status $RED "❌ $dir_name/ directory missing"
        fi
        echo ""
    done
    
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        print_status $YELLOW "⚠️  You have uncommitted changes"
        git status --porcelain | head -10
    else
        print_status $GREEN "✅ Working directory is clean"
    fi
}

# Function to check prerequisites
check_prerequisites() {
    # Check if we're in a git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        print_status $RED "❌ Not in a git repository"
        exit 1
    fi
    
    # Check if we're in the project root
    if [ ! -f "$PROJECT_ROOT/package.json" ]; then
        print_status $RED "❌ Not in project root (package.json not found)"
        exit 1
    fi
    
    # Check git sparse-checkout support
    if ! git sparse-checkout --help > /dev/null 2>&1; then
        print_status $RED "❌ Git sparse-checkout not supported (requires Git 2.25+)"
        exit 1
    fi
}

# Main execution
main() {
    local command=${1:-help}
    
    check_prerequisites
    
    case $command in
        sync)
            print_status $BLUE "🔄 Starting full directory sync..."
            sync_directory "core"
            sync_directory "lib"
            print_status $GREEN "🎉 All directories synced successfully!"
            echo ""
            print_status $YELLOW "📝 Next steps:"
            echo "   1. Test the build: yarn install && yarn build"
            echo "   2. Review changes: git status"
            echo "   3. Commit the updates: git add . && git commit -m 'Update core/ and lib/ from vultisig-windows'"
            ;;
        sync-core)
            sync_directory "core"
            ;;
        sync-lib)
            sync_directory "lib"
            ;;
        status)
            show_status
            ;;
        help|--help|-h)
            show_usage
            ;;
        *)
            print_status $RED "❌ Unknown command: $command"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
