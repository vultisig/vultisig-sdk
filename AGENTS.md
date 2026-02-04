# AGENTS.md

TypeScript SDK for MPC (Multi-Party Computation) wallet operations. Secure vault creation, address derivation, and transaction signing across 36+ blockchains.

## Commands

```bash
# Build
yarn build:sdk        # Full SDK build (all platforms)
yarn build:fast       # Node-only build (faster)
yarn dev              # Watch mode

# Test
yarn test             # Unit tests
yarn test:e2e         # E2E tests (requires vault file)
yarn check:all        # Lint + typecheck + tests + knip

# Quality
yarn format           # Prettier
yarn lint:fix         # ESLint auto-fix
yarn typecheck        # TypeScript check
```

## Project Structure

```
packages/sdk/src/     # Main SDK source - EDIT HERE
packages/sdk/tests/   # Unit, integration, e2e tests
packages/core/        # UPSTREAM - DO NOT EDIT
packages/lib/         # UPSTREAM - DO NOT EDIT
clients/cli/          # CLI workspace - EDIT HERE
examples/             # Browser, Electron examples
docs/                 # Documentation
```

## Boundaries

| Directory | Editable | Notes |
|-----------|----------|-------|
| `packages/sdk/` | Yes | Main SDK implementation |
| `clients/cli/` | Yes | CLI tool |
| `examples/` | Yes | Example apps |
| `packages/core/` | No | Synced from vultisig-windows |
| `packages/lib/` | No | WASM bindings (dkls, schnorr) |

To update upstream code: `yarn sync-and-copy`

## Architecture

See [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) for comprehensive architecture documentation.

**Key concepts:**
- **Layered architecture**: Services > Adapters > Core
- **Two vault types**: FastVault (2-of-2 server-assisted) | SecureVault (N-of-M multi-device)
- **Multi-platform builds**: Node ESM/CJS, Browser, React Native, Electron
- **Event-driven**: UniversalEventEmitter for progress tracking

**Design patterns used:**
- Adapter (chain-specific implementations)
- Strategy (signing algorithms: ECDSA vs EdDSA)
- Factory (vault creation)
- Observer (event system)

## Code Style

- TypeScript strict mode
- Path aliases: `@core/*` → `packages/core/`, `@lib/*` → `packages/lib/`
- Custom errors: `VaultError`, `StorageError` with error codes
- PascalCase for classes, camelCase for functions/variables
- Export types from `src/types/index.ts`

## Key Entry Points

| Class | Purpose | Location |
|-------|---------|----------|
| `Vultisig` | Main SDK entry point | `packages/sdk/src/Vultisig.ts` |
| `FastVault` | 2-of-2 server-assisted vault | `packages/sdk/src/vault/FastVault.ts` |
| `SecureVault` | N-of-M multi-device vault | `packages/sdk/src/vault/SecureVault.ts` |
| `Chain` | Supported chains enum | `packages/core/chain/Chain.ts` |

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

## Changesets

Use exact package names from package.json:
- `@vultisig/sdk` - Main SDK
- `@vultisig/cli` - CLI tool

## Documentation

| File | Purpose |
|------|---------|
| [docs/SDK-USERS-GUIDE.md](docs/SDK-USERS-GUIDE.md) | In-depth SDK tutorial |
| [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | Architecture & design patterns |
| [clients/cli/README.md](clients/cli/README.md) | CLI documentation |
| [CLAUDE.md](CLAUDE.md) | Quick reference for Claude Code |
