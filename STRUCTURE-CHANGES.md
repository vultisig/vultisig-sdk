# Structure Changes Summary

## Directory Structure Changes

### Before:
```
vultisig-sdk/
├── src/                    # Workspace package (@vultisig/sdk)
│   ├── package.json
│   └── (source code)
├── core/                   # Shared core code
├── lib/                    # Shared lib code
└── package.json            # Root workspace
```

### After:
```
vultisig-sdk/
├── packages/
│   ├── sdk/               # Workspace package (@vultisig/sdk)
│   │   ├── package.json
│   │   ├── src/          # Source code
│   │   └── tests/        # Unit & integration tests
│   ├── core/             # Shared core code (not a workspace)
│   └── lib/              # Shared lib code (not a workspace)
├── clients/cli/           # CLI workspace
├── examples/              # Example workspaces
└── package.json           # Root workspace
```

## Path Aliases

All imports now use TypeScript path aliases:
- `@core/*` → `packages/core/*`
- `@lib/*` → `packages/lib/*`

## Files Updated

### Configuration Files
- ✅ `package.json` - Workspace paths, lint scripts, test scripts
- ✅ `tsconfig.json` - Include paths updated to `packages/**`
- ✅ `vitest.config.ts` - Aliases point to `packages/core` and `packages/lib`
- ✅ `knip.json` - Ignore paths updated to `packages/core/mpc/types/**`
- ✅ `packages/sdk/tsconfig.json` - Path aliases and extends path
- ✅ `packages/sdk/package.json` - Test scripts added
- ✅ `packages/sdk/vitest.config.ts` - Created with proper aliases
- ✅ `packages/sdk/tests/integration/vitest.config.ts` - Updated aliases

### Source Code
- ✅ All imports in `packages/sdk/src/**` converted to use `@core/` and `@lib/`
- ✅ Static imports: `from '@core/...'` and `from '@lib/...'`
- ✅ Dynamic imports: `import('@core/...')` and `import('@lib/...')`

### Scripts
- ✅ `scripts/sync-and-copy.ts` - Updated all paths to use `packages/` (handles both static and dynamic imports)

### Archived
- 📦 `rollup.config.js` (root) → `archived/rollup.config.js.old`
- 📦 Migration scripts → `archived/migration-scripts/` (one-time use, no longer needed)

## Running Tests

From root:
```bash
yarn test              # All tests
yarn test:unit         # Unit tests only
yarn test:integration  # Integration tests only
yarn test:watch        # Watch mode
```

From SDK package:
```bash
cd packages/sdk
yarn test              # All tests
yarn test:unit         # Unit tests only
yarn test:integration  # Integration tests only
yarn test:unit:watch   # Watch unit tests
```

## Building

```bash
yarn build:sdk         # Build SDK package
yarn build:sdk-full    # Sync and build SDK
```
