# Contributing to @vultisig/rujira

This package is part of the [Vultisig SDK monorepo](../../README.md). Please follow the root [CONTRIBUTING.md](../../CONTRIBUTING.md) for setup, workflow, and PR guidelines.

## Quick Start

```bash
# From the monorepo root (not this directory)
corepack enable
yarn install
yarn build:assets && yarn build:rujira

# Run tests
yarn test:rujira

# Lint and format (handled from root)
yarn lint
yarn format
```

## Package-Specific Notes

- **Asset denominations**: Always use on-chain denoms (`'rune'`, `'btc-btc'`) not display names (`'THOR.RUNE'`, `'BTC.BTC'`)
- **Error handling**: Use `RujiraError` with appropriate `RujiraErrorCode` and set `retryable` for network errors
- **Tests**: Located in `src/__tests__/`, run via `yarn test:rujira` from root
