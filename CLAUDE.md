# Vultisig SDK

TypeScript SDK for multi-party computation (MPC) wallet operations. Supports 40+ blockchains with secure vault creation, address derivation, and transaction signing.

## Shared Code: core & lib

`packages/core/` and `packages/lib/` contain chain implementations, MPC protocols, and utility libraries shared with the Windows codebase. The SDK **owns** these packages — edit them freely. The Windows repo will consume the SDK as a dependency (not the other way around).

## Project Structure

```text
packages/sdk/src/     # Main SDK source
packages/sdk/tests/   # Unit, integration, e2e tests
packages/rujira/      # Rujira DEX integration (@vultisig/rujira), includes asset registry
packages/core/        # Shared chain logic, MPC protocols
packages/lib/         # Shared utilities, WASM bindings (dkls, mldsa, schnorr)
clients/cli/          # CLI workspace
examples/             # Browser, Electron examples
```

## Key Commands

```bash
# Build
yarn build:sdk          # Full SDK build
yarn build:shared       # Compile shared @vultisig/core-* / lib-* into packages/*/dist
yarn pack:shared        # build:shared + npm pack --dry-run for each shared package
yarn build:rujira       # Build Rujira package

# Build (workspace-level, run from packages/sdk/)
yarn workspace @vultisig/sdk build:fast   # Fast build (node only)
yarn workspace @vultisig/sdk dev          # Watch mode

# Test
yarn test               # SDK unit tests
yarn test:rujira        # Rujira tests (includes asset tests)
yarn test:unit:watch    # Unit tests in watch mode
yarn test:e2e           # E2E tests (requires vault file)
yarn test:all           # All tests

# Quality
yarn check              # typecheck + lint + knip (parallel, fast)
yarn check:all          # check + tests
yarn format             # Prettier
yarn lint:fix           # ESLint auto-fix
yarn typecheck          # TypeScript check

# Dependencies
yarn update             # Update all deps to latest (yarn + ncu + install)
```

## Architecture

### Two Vault Types
- **FastVault**: 2-of-2 threshold, server-assisted signing (VultiServer), always encrypted
- **SecureVault**: N-of-M threshold, multi-device signing via relay, configurable encryption

### Multi-Platform Builds
SDK builds to 6 bundles via Rollup:
- Node.js ESM/CJS
- Browser
- React Native
- Electron Main
- Chrome Extension

### Key Entry Points
- `Vultisig` class - Main SDK entry point
- `FastVault`, `SecureVault` - Vault implementations
- `Chain` enum - All supported chains
- Types exported from `src/types/index.ts`
- Compound wrappers on `VaultBase`: `signMessage()`, `allBalances()`, `portfolio()`, `send()`, `swap()` — single-call operations with human-readable amounts, auto token resolution from knownTokens registry (`send`/`swap` support dryRun)

## Code Conventions

- TypeScript strict mode
- Path aliases: `@vultisig/core-chain`, `@vultisig/core-mpc`, `@vultisig/core-config`, `@vultisig/lib-utils`, and WASM packages under `packages/lib/*` (see each package’s `package.json` name)
- Custom error classes: `VaultError`, `StorageError` with error codes
- Event-driven: Use `UniversalEventEmitter` for progress tracking
- PascalCase for classes, camelCase for functions/variables

## Changesets

When creating changesets, use the exact package names from package.json:
- `@vultisig/sdk` - Main SDK (packages/sdk)
- `@vultisig/cli` - CLI tool (clients/cli)
- `@vultisig/rujira` - Rujira DEX integration (packages/rujira)
- `@vultisig/core-chain`, `@vultisig/core-mpc`, `@vultisig/core-config`, `@vultisig/lib-utils`, `@vultisig/lib-dkls`, `@vultisig/lib-mldsa`, `@vultisig/lib-schnorr` - Published shared libraries (lockstep version; `core-chain` / `core-mpc` reference each other and sibling libs with **exact** semver in `package.json` so `npm pack` is valid off-repo—update those literals whenever you bump the shared version)

**Do not** use variations like `@vultisig/vultisig-sdk` or `@anthropic/vultisig-sdk`.

## Testing

- **Unit**: `tests/unit/` - Fast, isolated (vitest)
- **Integration**: `tests/integration/` - Service layer
- **E2E**: `tests/e2e/` - Full workflows, requires real vault file
- **Core / shared lib**: colocated `*.test.ts` under `packages/core/` and `packages/lib/` — `yarn test` runs these via `yarn test:core` (Vitest, `.config/vitest.core.config.ts`; no separate build required)

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
