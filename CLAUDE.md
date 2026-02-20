# Vultisig SDK

TypeScript SDK for multi-party computation (MPC) wallet operations. Supports 40+ blockchains with secure vault creation, address derivation, and transaction signing.

## Critical: Upstream Code

**DO NOT EDIT** these directories - they are synced from vultisig-windows:
- `packages/core/` - Chain implementations, MPC protocols
- `packages/lib/` - Utilities, WASM bindings (dkls, schnorr)

To update upstream code: `yarn sync-and-copy`

## Project Structure

```text
packages/sdk/src/     # Main SDK source (edit here)
packages/sdk/tests/   # Unit, integration, e2e tests
packages/rujira/      # Rujira DEX integration (@vultisig/rujira), includes asset registry
packages/core/        # UPSTREAM - do not edit
packages/lib/         # UPSTREAM - do not edit
clients/cli/          # CLI workspace
examples/             # Browser, Electron examples
```

## Key Commands

```bash
# Build
yarn build:sdk          # Full SDK build
yarn build:fast         # Fast build (node only)
yarn build:rujira       # Build Rujira package
yarn dev                # Watch mode

# Test
yarn test               # SDK unit tests
yarn test:rujira        # Rujira tests (includes asset tests)
yarn test:unit:watch    # Unit tests in watch mode
yarn test:e2e           # E2E tests (requires vault file)
yarn test:all           # All tests

# Quality
yarn check:all          # lint + typecheck + tests + knip
yarn format             # Prettier
yarn lint:fix           # ESLint auto-fix
yarn typecheck          # TypeScript check
```

## Architecture

### Two Vault Types
- **FastVault**: 2-of-2 threshold, server-assisted signing (VultiServer), always encrypted
- **SecureVault**: N-of-M threshold, multi-device signing via relay, configurable encryption

### Multi-Platform Builds
SDK builds to 5 bundles via Rollup:
- Node.js ESM/CJS
- Browser
- React Native
- Electron Main

### Key Entry Points
- `Vultisig` class - Main SDK entry point
- `FastVault`, `SecureVault` - Vault implementations
- `Chain` enum - All supported chains
- Types exported from `src/types/index.ts`

## Code Conventions

- TypeScript strict mode
- Path aliases: `@core/*` → `packages/core/`, `@lib/*` → `packages/lib/`
- Custom error classes: `VaultError`, `StorageError` with error codes
- Event-driven: Use `UniversalEventEmitter` for progress tracking
- PascalCase for classes, camelCase for functions/variables

## Changesets

When creating changesets, use the exact package names from package.json:
- `@vultisig/sdk` - Main SDK (packages/sdk)
- `@vultisig/cli` - CLI tool (clients/cli)
- `@vultisig/rujira` - Rujira DEX integration (packages/rujira)

**Do not** use variations like `@vultisig/vultisig-sdk` or `@anthropic/vultisig-sdk`.

## Testing

- **Unit**: `tests/unit/` - Fast, isolated (vitest)
- **Integration**: `tests/integration/` - Service layer
- **E2E**: `tests/e2e/` - Full workflows, requires real vault file

Specific E2E tests: `yarn test:e2e:balance`, `yarn test:e2e:signing`, etc.

## Common Tasks

### Adding a new chain feature
1. Check if chain logic exists in `packages/core/chain/`
2. Add SDK-level support in `packages/sdk/src/`
3. Add tests in `packages/sdk/tests/`

### Debugging vault operations
- FastVault signing: `src/server/FastSigningService.ts`
- SecureVault signing: `src/services/RelaySigningService.ts`
- Vault creation: `src/services/SecureVaultCreationService.ts`

### Working with seedphrases
- Validation: `src/seedphrase/SeedphraseValidator.ts`
- Languages: `src/seedphrase/languages/` (10 supported)
- Discovery: `src/seedphrase/ChainDiscoveryService.ts`
