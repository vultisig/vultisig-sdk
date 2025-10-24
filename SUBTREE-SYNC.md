# Directory Synchronization

This document explains how the `upstream/` directory is synchronized with the [vultisig-windows](https://github.com/vultisig/vultisig-windows) repository using git sparse checkout.

## Overview

The `upstream/` directory contains reference code synchronized from the vultisig-windows repository:
- `upstream/core/` - Core blockchain and MPC functionality
- `upstream/lib/` - Utility libraries and WASM modules
- `upstream/clients/` - Reference client implementations (e.g., extension)

**These directories are NOT compiled and NOT workspaces.** They serve only as source material. Selected files are copied to `src/core/` and `src/lib/` with import transformations during the build process.

## Setup

The directories are synchronized from:
- **Repository**: https://github.com/vultisig/vultisig-windows.git
- **Branch**: main
- **Directories**: `core/`, `lib/`, and `clients/` → saved to `upstream/`

## Usage

### Using yarn scripts (Recommended)

```bash
# Sync from vultisig-windows and copy to src/ with import transformations
yarn sync-and-copy

# Build SDK with full sync
yarn build:sdk-full
```

### Using the script directly

```bash
# Run the full workflow (sync + copy)
node_modules/.bin/tsx scripts/sync-and-copy.ts

# Show help
node_modules/.bin/tsx scripts/sync-and-copy.ts --help
```

### Advanced Options

The script supports optional flags for more control:

```bash
# Only sync from remote (skip copy to src/)
node_modules/.bin/tsx scripts/sync-and-copy.ts --sync-only

# Only copy to src/ (skip remote sync)
node_modules/.bin/tsx scripts/sync-and-copy.ts --copy-only

# Only process core/ directory
node_modules/.bin/tsx scripts/sync-and-copy.ts --core-only

# Only process lib/ directory
node_modules/.bin/tsx scripts/sync-and-copy.ts --lib-only
```

## How It Works

### Two-Step Process

The `sync-and-copy.ts` script performs two main operations:

#### Step 1: Sync from Remote
Uses git sparse checkout to efficiently download only the specific directories we need from the vultisig-windows repository:
- Downloads only the required directories (not the entire repository)
- Creates clean, independent copies of the directories
- Automatically backs up existing directories before replacement
- Updates `upstream/core/`, `upstream/lib/`, and `upstream/clients/` with fresh content from vultisig-windows

#### Step 2: Copy to src/ with Transformations
Copies selected files from `upstream/` to `src/`:
- Copies only the files needed for the SDK build (from `upstream/core/` and `upstream/lib/`)
- Transforms `@core/*` and `@lib/*` imports to relative paths
- Maintains proper file structure for bundling
- Reports detailed statistics on copied files

### Detailed Process

1. **Prerequisites Check**: Verifies git repository, sparse-checkout support, and package.json
2. **Remote Sync**: Creates temporary sparse checkout of vultisig-windows
3. **Backup**: Backs up existing directories to `archived/` with timestamps
4. **Update**: Replaces local directories with fresh content
5. **Clean src/**: Removes existing `src/core/` and `src/lib/` directories
6. **Copy Files**: Copies folders and individual files with import transformations
7. **Report**: Provides detailed statistics and next steps
8. **Cleanup**: Removes temporary files

## Workflow

### Regular Synchronization

It's recommended to sync the subtrees regularly, especially:
- Before starting new development work
- When core functionality changes are expected
- As part of your regular dependency update routine

### After Synchronization

1. **Test the build**: Run `yarn install && yarn build` to ensure compatibility
2. **Review changes**: Check `git log --oneline -10` for recent updates
3. **Commit adjustments**: If any local modifications are needed, commit them separately

## Troubleshooting

### Merge Conflicts

If you encounter merge conflicts during sync:

1. **Resolve conflicts manually**: Edit the conflicted files
2. **Stage resolved files**: `git add <resolved-files>`
3. **Complete the merge**: `git commit`

### Failed Sync

If a sync fails:

1. **Check network connectivity** to GitHub
2. **Ensure clean working directory**: Commit or stash local changes
3. **Try individual subtree sync**: Use `sync-core` or `sync-lib` instead of full sync
4. **Reset if necessary**: `git subtree pull --strategy=ours` to force override

### Subtree Not Found

If the script reports missing subtrees:

1. **Check directory existence**: Ensure `core/` and `lib/` directories exist
2. **Verify subtree setup**: Run `git log --grep="git-subtree-dir: core"` to check history
3. **Re-add subtree if needed**: Contact maintainers for subtree re-initialization

## Advanced Usage

### Manual Subtree Commands

For advanced users, you can use git subtree commands directly:

```bash
# Add a new subtree (initial setup only)
git subtree add --prefix=core https://github.com/vultisig/vultisig-windows.git main --squash

# Pull updates
git subtree pull --prefix=core https://github.com/vultisig/vultisig-windows.git main --squash

# Push changes back (if you have write access)
git subtree push --prefix=core https://github.com/vultisig/vultisig-windows.git main
```

### Pushing Changes Back

If you need to contribute changes back to vultisig-windows:

1. **Make changes** in `core/` or `lib/` directories
2. **Commit changes** to this repository
3. **Push to upstream**: `git subtree push --prefix=core https://github.com/vultisig/vultisig-windows.git main`

## Best Practices

1. **Regular Updates**: Sync subtrees at least weekly or before major development
2. **Clean Working Directory**: Always sync with a clean working directory
3. **Test After Sync**: Run tests and builds after synchronization
4. **Separate Commits**: Keep subtree syncs and local changes in separate commits
5. **Document Changes**: Note any compatibility changes in commit messages

## Backup and Recovery

The original `core/` and `lib/` directories have been backed up to:
- `archived/core-backup-YYYYMMDD-HHMMSS/`
- `archived/lib-backup-YYYYMMDD-HHMMSS/`

These backups can be used for reference or recovery if needed.

## Support

For issues with subtree synchronization:
1. Check this documentation
2. Review recent commits with `git log --oneline --grep="subtree"`
3. Contact the development team
4. Create an issue in the repository

## Technical Details

- **Subtree Strategy**: Squash merges to maintain clean history
- **Remote Repository**: vultisig-windows (main branch)
- **Update Frequency**: Manual (on-demand)
- **Conflict Resolution**: Manual merge resolution required
