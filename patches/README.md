# Patches Directory

This directory contains patches for modifications to files synced from the upstream `vultisig-windows` repository.

## Why Patches?

The `src/core` and `src/lib` directories are synced from upstream using `yarn sync-and-copy`, which:
1. Uses git sparse-checkout to fetch from `vultisig-windows` repo
2. Copies files to `upstream/` (read-only)
3. Copies from `upstream/` to `src/` with import transformations

**Any direct modifications to `src/core` or `src/lib` will be overwritten** when syncing from upstream.

Patches let you maintain custom modifications that are reapplied automatically after each sync.

## Directory Structure

```
patches/
├── README.md              # This file
├── temp-changes.patch     # Auto-generated during sync (temporary)
└── permanent/             # Your permanent patches
    ├── fix-wasm-loading.patch
    └── solana-client-fix.patch
```

## Usage

### Basic Workflow

```bash
# Instead of running sync-and-copy directly, use:
yarn sync-with-patches

# This will:
# 1. Save your current src/ modifications
# 2. Run sync-and-copy (overwrites src/)
# 3. Apply permanent patches
# 4. Reapply your temporary modifications
```

### Creating a Permanent Patch

If you have modifications you want to keep across syncs:

```bash
# 1. Make your changes in src/
# 2. Create a patch with a descriptive name
git diff src/ > patches/permanent/my-fix-description.patch

# Or after running sync-with-patches:
mv patches/temp-changes.patch patches/permanent/my-fix-description.patch
```

### Managing Permanent Patches

```bash
# View all permanent patches
ls -la patches/permanent/

# View what a patch changes
cat patches/permanent/my-fix.patch

# Remove a patch you no longer need
rm patches/permanent/old-fix.patch

# Update an existing patch
git diff src/path/to/file.ts > patches/permanent/existing-fix.patch
```

### Manual Patch Application

If automatic application fails:

```bash
# Try applying with reject (creates .rej files for conflicts)
git apply --reject patches/permanent/my-fix.patch

# View conflicts
find src/ -name "*.rej"

# Manually resolve and remove .rej files
vim src/path/to/file.ts.rej
rm src/path/to/file.ts.rej
```

## Best Practices

1. **Use descriptive names**: `fix-wasm-loading.patch` not `patch1.patch`
2. **Keep patches small**: One fix per patch file
3. **Document why**: Add comments in the patch description
4. **Review regularly**: Remove patches that are no longer needed
5. **Test after sync**: Always test that patches apply correctly

## Advanced: Creating Patches with Context

More context makes patches more resilient to upstream changes:

```bash
# Create patch with 10 lines of context (default is 3)
git diff -U10 src/ > patches/permanent/my-fix.patch

# Create a patch for specific files only
git diff src/lib/dkls/vs_wasm.js src/core/chain/client.ts > patches/permanent/specific-files.patch
```

## Troubleshooting

### Patch Won't Apply

```bash
# Try 3-way merge
git apply --3way patches/permanent/my-fix.patch

# If still fails, the upstream file changed too much
# You'll need to recreate the patch:
# 1. Revert to clean state: git checkout src/path/to/file.ts
# 2. Manually reapply your fix
# 3. Recreate patch: git diff src/path/to/file.ts > patches/permanent/my-fix.patch
```

### Multiple Patches Conflict

If two patches modify the same file:
1. Combine them into one patch
2. Or apply them in specific order (rename with prefixes like `01-fix.patch`, `02-fix.patch`)

## When NOT to Use Patches

- **For new files**: Add them outside `src/core` and `src/lib`
- **For configuration**: Use config files or environment variables
- **For major changes**: Consider forking upstream or proposing changes to vultisig-windows

## Examples

### Example: Fix WASM Loading Issue

```bash
# 1. Make your fix in src/lib/dkls/vs_wasm.js
vim src/lib/dkls/vs_wasm.js

# 2. Test it works
yarn dev:react

# 3. Create permanent patch
git diff src/lib/dkls/vs_wasm.js > patches/permanent/fix-wasm-loading.patch

# 4. Next time you sync, it auto-applies
yarn sync-with-patches
```

### Example: Multiple File Fix

```bash
# Fix affects multiple files
git diff src/ > patches/permanent/solana-integration-fixes.patch

# Verify what's in the patch
git apply --stat patches/permanent/solana-integration-fixes.patch
```
