# Contributing to Vultisig SDK

Thank you for your interest in contributing to the Vultisig SDK!

## Development Setup

### Prerequisites

- Node.js 20+
- Yarn 4.x (via Corepack)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/vultisig/vultisig-sdk.git
cd vultisig-sdk

# Enable Corepack (for Yarn 4)
corepack enable

# Install dependencies (from root - this is a monorepo)
yarn install

# Build the SDK
yarn build:sdk

# Run tests
yarn test
```

## Project Structure

This is a Yarn workspaces monorepo:

```
vultisig-sdk/
├── packages/
│   ├── sdk/               # SDK workspace package (@vultisig/sdk)
│   │   ├── src/          # SDK source code
│   │   │   ├── chains/   # Address derivation and chain management
│   │   │   ├── mpc/      # Multi-party computation logic
│   │   │   ├── vault/    # Vault creation and management
│   │   │   ├── server/   # Fast vault server integration
│   │   │   └── wasm/     # WASM module management
│   │   └── tests/        # SDK test suite
│   ├── rujira/           # Rujira DEX integration (@vultisig/rujira), includes asset registry
│   ├── core/             # Shared chain, MPC, config (@vultisig/core-*)
│   │   ├── chain/        # Chain-specific implementations
│   │   ├── config/       # Configuration and constants
│   │   └── mpc/          # MPC protocol implementations
│   └── lib/              # Shared utilities and WASM (@vultisig/lib-*)
│       ├── utils/        # Common utilities
│       ├── dkls/         # DKLS WASM bindings
│       ├── mldsa/        # ML-DSA (post-quantum) WASM bindings
│       └── schnorr/      # Schnorr signature WASM bindings
├── clients/cli/          # CLI workspace (@vultisig/cli)
├── examples/             # Example workspaces
└── docs/                 # Documentation
```

### Shared core and lib

`packages/core/` and `packages/lib/` are **maintained in this repository** and published as `@vultisig/core-*` and `@vultisig/lib-*`. The Windows desktop and extension consume those packages; they are not copied in from another repo. See [docs/shared-core-lib.md](docs/shared-core-lib.md).

### Path Aliases

All imports use TypeScript path aliases (package names match `package.json` in each workspace):

- `@vultisig/core-chain/*` → `packages/core/chain/*`
- `@vultisig/core-mpc/*` → `packages/core/mpc/*`
- `@vultisig/core-config` and `@vultisig/core-config/*` → `packages/core/config/*`
- `@vultisig/lib-utils/*` → `packages/lib/utils/*`
- `@vultisig/lib-dkls/*`, `@vultisig/lib-mldsa/*`, `@vultisig/lib-schnorr/*` → `packages/lib/<pkg>/*`

### Workspace Bundling

The SDK uses **workspace bundling** - it includes all necessary code from `core/` and `lib/` packages into a single distributable bundle. When you run `yarn build:sdk`, it creates the distributable SDK package in `packages/sdk/dist/` with all workspace dependencies bundled.

## Code Style

We use ESLint and Prettier for code formatting:

```bash
# Check linting
yarn lint

# Auto-fix linting issues
yarn lint:fix

# Format code
yarn format
```

## Testing

```bash
# Run unit tests
yarn test:unit

# Run integration tests (same suite as CI job "Integration Tests (Vitest)")
yarn test:integration

# Run e2e tests (requires vault file)
yarn test:e2e

# Run all tests
yarn test:all
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `yarn build:sdk` | Build the SDK with all workspace dependencies |
| `yarn build:rujira` | Build the Rujira package |
| `yarn test` | Run SDK tests |
| `yarn test:rujira` | Run Rujira tests |
| `yarn test:unit` | Run unit tests only |
| `yarn test:integration` | Run integration tests |
| `yarn test:e2e` | Run end-to-end tests (requires vault) |
| `yarn lint` | Run ESLint across all packages |
| `yarn lint:fix` | Auto-fix linting issues |
| `yarn format` | Format code with Prettier |
| `yarn typecheck` | Run TypeScript type checking |
| `yarn knip` | Find unused exports and unreachable files (see `.config/knip.json`) |
| `yarn check` | Run typecheck, lint, knip, and Prettier check in parallel |
| `yarn build:shared` | Build shared `@vultisig/core-*` / `@vultisig/lib-*` packages |
| `yarn docs` | Generate TypeDoc API documentation |

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Ensure tests pass (`yarn test`)
5. Ensure quality checks pass (`yarn check` — same gates as CI: typecheck, lint, knip, Prettier)
6. **Add a changeset** if your changes affect the published packages (`yarn changeset`)
7. Commit with a descriptive message
8. Push to your fork
9. Open a Pull Request

### Commit Messages

Use clear, descriptive commit messages:

- `feat: add new blockchain support`
- `fix: resolve address derivation bug`
- `docs: update Quick Start guide`
- `test: add vault creation tests`
- `chore: update dependencies`

## Important Notes

### WASM artifacts

WASM binaries ship with `packages/lib/*` and are bundled into `@vultisig/sdk`. Rebuild the relevant lib package (see its `package.json` and any Rust/build docs in that folder), then run `yarn build:shared` from the repo root so distributables stay in sync.

## CI/CD

### GitHub Actions Workflows

| Workflow | Trigger | Description |
|----------|---------|-------------|
| `test.yml` | PR opened/updated | Unit tests, lint, typecheck, knip, Prettier check, Codecov |
| `release-pr.yml` | Push to main | Auto-creates "Version Packages" PR when changesets exist |
| `release.yml` | Merge version PR | npm publish, GitHub release, Vercel deploy, docs sync, Discord notify |
| `release-manual.yml` | Manual dispatch | Force-run release steps (Vercel, docs sync, Discord) |

### Automated Checks

Every PR runs:
- ESLint
- Prettier (`yarn format:check` on SDK, Rujira, CLI, examples)
- TypeScript type checking
- Knip (unused exports / dead code in analyzed workspaces)
- Unit tests (387+ tests)
- Integration tests (`yarn test:integration` — same suite as CI job "Integration Tests (Vitest)")
- SDK build verification

Pre-commit hooks (via Husky) run lint-staged on changed files.

## Release Process

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

### For Contributors: Adding a Changeset

When you make changes that should be released (bug fixes, new features, etc.), you need to add a changeset:

```bash
# Run the changeset command
yarn changeset
```

This will prompt you to:
1. **Select packages** - Choose which packages your changes affect (`@vultisig/sdk`, `@vultisig/cli`, `@vultisig/rujira`, `@vultisig/core-chain`, `@vultisig/core-config`, `@vultisig/core-mpc`, `@vultisig/lib-utils`, `@vultisig/lib-dkls`, `@vultisig/lib-mldsa`, `@vultisig/lib-schnorr`)
2. **Select bump type** - Choose the version bump:
   - `patch` - Bug fixes, minor changes (0.1.0 → 0.1.1)
   - `minor` - New features, non-breaking changes (0.1.0 → 0.2.0)
   - `major` - Breaking changes (0.1.0 → 1.0.0)
3. **Write a summary** - Describe what changed (this appears in the changelog)

A markdown file will be created in `.changeset/`. **Commit this file with your PR.**

#### When to Add a Changeset

| Change Type | Needs Changeset? | Bump Type |
|-------------|------------------|-----------|
| Bug fix | Yes | `patch` |
| New feature | Yes | `minor` |
| Breaking API change | Yes | `major` |
| Documentation only | No | - |
| Tests only | No | - |
| Internal refactor (no API change) | No | - |
| Dev dependencies | No | - |

#### Example Changeset

```markdown
---
"@vultisig/sdk": minor
---

Add support for Arbitrum chain with full ERC-20 token transfers
```

### For Maintainers: Publishing Releases

The release process is automated via the `release.yml` workflow:

1. **Accumulate changesets** - As PRs with changesets are merged to `main`, they accumulate
2. **Release PR created** - The Changesets action automatically creates/updates a "Version Packages" PR
3. **Review and merge** - When ready to release, review and merge the release PR
4. **Auto-publish** - Merging the release PR triggers:
   - Version bumps in package.json files
   - CHANGELOG.md updates with all changeset summaries
   - npm publish for affected packages
   - Git tags for each release

### Versioning

We follow [Semantic Versioning](https://semver.org/):
- `X.Y.Z` - Stable releases (current)
- `X.Y.Z-beta.N` - Beta pre-releases
- `X.Y.Z-alpha.N` - Alpha pre-releases

### npm Packages

| Package | Description |
|---------|-------------|
| `@vultisig/sdk` | Main SDK library |
| `@vultisig/cli` | Command-line interface |
| `@vultisig/rujira` | Rujira DEX integration (FIN swaps, deposits, withdrawals, asset registry) |
| `@vultisig/core-chain` | Shared chain logic package for first-party clients |
| `@vultisig/core-config` | Shared config/constants package |
| `@vultisig/core-mpc` | Shared MPC, vault, and keysign package |
| `@vultisig/lib-utils` | Shared utility helpers package |
| `@vultisig/lib-dkls` | DKLS WASM bindings |
| `@vultisig/lib-mldsa` | MLDSA WASM bindings |
| `@vultisig/lib-schnorr` | Schnorr WASM bindings |

## Questions?

- Open an issue on [GitHub](https://github.com/vultisig/vultisig-sdk/issues)
- Check the [SDK Users Guide](docs/SDK-USERS-GUIDE.md)

## License

By contributing, you agree that your contributions will be licensed under the project's license.
