#!/bin/bash

# Subtree Manager for vultisig-sdk
# Manages git subtrees for core/ and lib/ directories from vultisig-windows repository

set -e

REPO_URL="https://github.com/vultisig/vultisig-windows.git"
BRANCH="main"
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
    echo "  sync        Pull updates from vultisig-windows for both subtrees"
    echo "  sync-core   Pull updates for core/ subtree only"
    echo "  sync-lib    Pull updates for lib/ subtree only"
    echo "  status      Show subtree status and recent commits"
    echo "  help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 sync          # Sync both core/ and lib/"
    echo "  $0 sync-core     # Sync only core/"
    echo "  $0 status        # Check subtree status"
}

# Function to sync a subtree
sync_subtree() {
    local prefix=$1
    print_status $BLUE "📦 Syncing $prefix/ subtree from $REPO_URL ($BRANCH)..."
    
    cd "$PROJECT_ROOT"
    
    # Check if subtree exists
    if [ ! -d "$prefix" ]; then
        print_status $RED "❌ Directory $prefix/ does not exist. Run initial setup first."
        return 1
    fi
    
    # Pull updates from the remote repository
    if git subtree pull --prefix=$prefix $REPO_URL $BRANCH --squash; then
        print_status $GREEN "✅ Successfully synced $prefix/ subtree"
        
        # Show recent commits
        print_status $YELLOW "📋 Recent commits in $prefix/:"
        git log --oneline --max-count=3 -- $prefix/
        echo ""
    else
        print_status $RED "❌ Failed to sync $prefix/ subtree"
        return 1
    fi
}

# Function to show subtree status
show_status() {
    cd "$PROJECT_ROOT"
    
    print_status $BLUE "📊 Subtree Status Report"
    echo "=========================="
    
    for prefix in "core" "lib"; do
        if [ -d "$prefix" ]; then
            print_status $GREEN "✅ $prefix/ subtree exists"
            echo "   Last 3 commits:"
            git log --oneline --max-count=3 -- $prefix/ | sed 's/^/   /'
        else
            print_status $RED "❌ $prefix/ subtree missing"
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
}

# Main execution
main() {
    local command=${1:-help}
    
    check_prerequisites
    
    case $command in
        sync)
            print_status $BLUE "🔄 Starting full subtree sync..."
            sync_subtree "core"
            sync_subtree "lib"
            print_status $GREEN "🎉 All subtrees synced successfully!"
            echo ""
            print_status $YELLOW "📝 Next steps:"
            echo "   1. Test the build: yarn install && yarn build"
            echo "   2. Review changes: git log --oneline -10"
            echo "   3. Commit any necessary adjustments"
            ;;
        sync-core)
            sync_subtree "core"
            ;;
        sync-lib)
            sync_subtree "lib"
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
