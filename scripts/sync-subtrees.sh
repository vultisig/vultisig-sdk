#!/bin/bash

# Sync subtrees script for vultisig-sdk
# This script pulls updates from the vultisig-windows repository into core/ and lib/ subtrees

set -e

REPO_URL="https://github.com/vultisig/vultisig-windows.git"
BRANCH="main"

echo "🔄 Syncing subtrees from vultisig-windows repository..."

# Function to sync a subtree
sync_subtree() {
    local prefix=$1
    echo "📦 Syncing $prefix/ subtree..."
    
    # Pull updates from the remote repository
    if git subtree pull --prefix=$prefix $REPO_URL $BRANCH --squash; then
        echo "✅ Successfully synced $prefix/ subtree"
    else
        echo "❌ Failed to sync $prefix/ subtree"
        return 1
    fi
}

# Sync core/ subtree
sync_subtree "core"

# Sync lib/ subtree  
sync_subtree "lib"

echo "🎉 All subtrees synced successfully!"
echo ""
echo "📝 Next steps:"
echo "   1. Review the changes with: git log --oneline -10"
echo "   2. Test the build with: yarn install && yarn build"
echo "   3. Commit any necessary adjustments"
