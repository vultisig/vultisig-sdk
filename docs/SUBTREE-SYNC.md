# Code Synchronization from vultisig-windows

This SDK shares core functionality with [vultisig-windows](https://github.com/vultisig/vultisig-windows). We use a **sync-and-copy** approach to stay synchronized:

1. **Fetch** latest code from vultisig-windows (git sparse checkout)
2. **Save** to `upstream/` (git-ignored, fetched fresh each time)
3. **Copy** selected files to `src/` with import transformations

## Quick Start

```bash
# Sync latest code from vultisig-windows
yarn sync-and-copy

# Then build the SDK
yarn workspace @vultisig/sdk build
```

## Directory Structure

```
vultisig-sdk/
├── upstream/         # Fetched from vultisig-windows (git-ignored)
│   ├── core/        # Blockchain & MPC implementations
│   ├── lib/         # Utilities & WASM modules
│   └── clients/     # Reference implementations
├── src/             # SDK source with relative imports
│   ├── core/       # Copied from upstream/core (selected folders)
│   └── lib/        # Copied from upstream/lib (selected folders)
```

**Note:** `upstream/` is NOT tracked by git and NOT a workspace. It's just source material.

## How It Works

### Step 1: Sync from vultisig-windows

Uses git sparse checkout to fetch only what we need:

```bash
git clone --filter=blob:none --sparse \
  https://github.com/vultisig/vultisig-windows.git
git sparse-checkout set core/ lib/ clients/extension/
```

- Downloads only specific directories (not entire repo)
- Always gets latest from main branch
- Saves to `upstream/core/`, `upstream/lib/`, `upstream/clients/`

### Step 2: Copy to src/ with Transformations

Copies selected folders from `upstream/` to `src/`:

**Folders copied:**

```typescript
const foldersToCoopy = [
  "upstream/core/chain", // → src/core/chain/
  "upstream/core/mpc", // → src/core/mpc/
  "upstream/core/config", // → src/core/config/
  "upstream/lib/utils", // → src/lib/utils/
  "upstream/lib/dkls", // → src/lib/dkls/
  "upstream/lib/schnorr", // → src/lib/schnorr/
];
```

**Copy process:**

- Recursively copies all files and subdirectories
- Transforms imports: `@core/chain/Chain` → `../../chain/Chain`
- Handles `.ts`, `.tsx`, `.js`, `.d.ts` (with transformations)
- Handles `.wasm` files (direct copy)
