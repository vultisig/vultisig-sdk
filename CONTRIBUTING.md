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
│   ├── rujira/           # Rujira DEX integration (@vultisig/rujira)
│   ├── assets/           # Asset registry (@vultisig/assets)
│   ├── core/             # ⚠️ UPSTREAM CODE - DO NOT EDIT
│   │   ├── chain/        # Chain-specific implementations
│   │   ├── mpc/          # MPC protocol implementations
│   │   └── ui/           # UI components and utilities
│   └── lib/              # ⚠️ UPSTREAM CODE - DO NOT EDIT
│       ├── utils/        # Common utilities
│       ├── ui/           # UI library components
│       └── dkls/         # DKLS WASM bindings
├── clients/cli/          # CLI workspace (@vultisig/cli)
├── examples/             # Example workspaces
└── docs/                 # Documentation
```

### Upstream Code Warning

The `packages/core/` and `packages/lib/` directories contain code synced from the [vultisig-windows](https://github.com/vultisig/vultisig-windows) repository. **These directories should NEVER be modified directly.**

- ❌ **Do NOT** edit files in `packages/core/` or `packages/lib/`
- ✅ **Do** make changes in the upstream vultisig-windows repository
- ✅ **Do** sync changes using `yarn sync-and-copy` after upstream updates

### Path Aliases

All imports use TypeScript path aliases:

- `@core/*` → `packages/core/*`
- `@lib/*` → `packages/lib/*`

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

# Run integration tests
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
| `yarn build:assets` | Build the assets registry package |
| `yarn test` | Run SDK tests |
| `yarn test:rujira` | Run Rujira tests |
| `yarn test:assets` | Run assets tests |
| `yarn test:unit` | Run unit tests only |
| `yarn test:integration` | Run integration tests |
| `yarn test:e2e` | Run end-to-end tests (requires vault) |
| `yarn lint` | Run ESLint across all packages |
| `yarn lint:fix` | Auto-fix linting issues |
| `yarn format` | Format code with Prettier |
| `yarn typecheck` | Run TypeScript type checking |
| `yarn sync-and-copy` | Sync latest code from vultisig-windows |
| `yarn docs` | Generate TypeDoc API documentation |

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Ensure tests pass (`yarn test`)
5. Ensure linting passes (`yarn lint`)
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

### Upstream Code

The `packages/core/` and `packages/lib/` directories contain upstream code from the Vultisig mobile apps. **Do not modify these directly** - they are synced via the `sync-and-copy` script.

### WASM Files

WASM binaries are bundled with the SDK. If you need to update them, use:

```bash
yarn sync-and-copy
```

## CI/CD

### GitHub Actions Workflows

| Workflow | Trigger | Description |
|----------|---------|-------------|
| `build.yml` | Push to any branch | Lint, build, test, typecheck |
| `test.yml` | Push/PR to main | Full test suite |
| `release.yml` | Push to main | Create release PR or publish via Changesets |
| `docs.yml` | Push to main | Generate and deploy TypeDoc to GitHub Pages |

### Automated Checks

Every PR runs:
- ESLint + Prettier formatting
- TypeScript type checking
- Unit tests (387+ tests)
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
1. **Select packages** - Choose which packages your changes affect (`@vultisig/sdk`, `@vultisig/cli`, `@vultisig/rujira`, `@vultisig/assets`)
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
| `@vultisig/rujira` | Rujira DEX integration (FIN swaps, deposits, withdrawals) |
| `@vultisig/assets` | Asset registry for Rujira |

## Questions?

- Open an issue on [GitHub](https://github.com/vultisig/vultisig-sdk/issues)
- Check the [SDK Users Guide](docs/SDK-USERS-GUIDE.md)

## License

By contributing, you agree that your contributions will be licensed under the project's license.
