# Git Subtree Synchronization

This document explains how the `core/` and `lib/` directories are synchronized with the [vultisig-windows](https://github.com/vultisig/vultisig-windows) repository using git subtrees.

## Overview

The `core/` and `lib/` directories in this repository are automatically synchronized with the corresponding directories from the vultisig-windows repository. This allows us to maintain a single source of truth for core functionality while keeping the SDK repository focused on its specific concerns.

## Setup

The subtrees have been configured to pull from:
- **Repository**: https://github.com/vultisig/vultisig-windows.git
- **Branch**: main
- **Directories**: `core/` and `lib/`

## Usage

### Using yarn scripts (Recommended)

```bash
# Sync both core/ and lib/ directories
yarn sync:subtrees

# Sync only core/ directory
yarn sync:core

# Sync only lib/ directory  
yarn sync:lib

# Check subtree status
yarn subtree:status
```

### Using the script directly

```bash
# Show all available commands
./scripts/subtree-manager.sh help

# Sync both subtrees
./scripts/subtree-manager.sh sync

# Sync individual subtrees
./scripts/subtree-manager.sh sync-core
./scripts/subtree-manager.sh sync-lib

# Check status
./scripts/subtree-manager.sh status
```

## How It Works

### Git Subtree Basics

Git subtrees allow you to include and synchronize external repositories as subdirectories in your main repository. Unlike git submodules, subtrees:
- Store the actual files in your repository (not just references)
- Don't require special commands for other developers to work with
- Integrate seamlessly with normal git workflows

### Synchronization Process

1. **Fetch**: Downloads the latest changes from vultisig-windows
2. **Merge**: Integrates changes using `git subtree pull`
3. **Squash**: Combines all remote commits into a single commit to keep history clean

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
