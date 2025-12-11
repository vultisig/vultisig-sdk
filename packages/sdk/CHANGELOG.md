# @vultisig/sdk

## 0.2.0-alpha.3

### Minor Changes

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - **BREAKING**: Change fast vault creation API to return vault from verification
  - `createFastVault()` now returns `Promise<string>` (just the vaultId)
  - `verifyVault()` now returns `Promise<FastVault>` instead of `Promise<boolean>`
  - Vault is only persisted to storage after successful email verification
  - If process is killed before verification, vault is lost (user recreates)

  This is a cleaner API - the user only gets the vault after it's verified and persisted.

### Patch Changes

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Update ARCHITECTURE.md and SDK-USERS-GUIDE.md to reflect current codebase state: fix version number, monorepo structure, createFastVault API example, platform bundles table, and storage layer description.

## 0.1.1-alpha.0

### Patch Changes

- [`cc96f64`](https://github.com/vultisig/vultisig-sdk/commit/cc96f64622a651eb6156f279afbbfe0aa4219179) - fix: re-release as alpha (0.1.0 was accidentally published as stable)

## 0.1.0

### Patch Changes

- [`8694cd9`](https://github.com/vultisig/vultisig-sdk/commit/8694cd957573b8334ff0f29167f8b45c5140ce42) - Add BrowserStorage and FileStorage to TypeScript documentation

- [`1f20084`](https://github.com/vultisig/vultisig-sdk/commit/1f20084bdaf6ddf00d2dd5c70ec6070e00a94e91) - docs: update documentation to reflect current SDK and CLI interfaces
  - Fix import paths: use `@vultisig/sdk` instead of platform-specific paths (`/node`, `/browser`)
  - Update Node.js version requirement from 18+ to 20+
  - Fix Storage interface documentation (generic types, correct method signatures)
  - Fix WASM copy instruction package name (`@vultisig/sdk` not `vultisig-sdk`)
  - Add missing CLI environment variable `VULTISIG_VAULT`
  - Add missing CLI interactive shell commands (`vault`, `.clear`)
  - Add `--vault` global option to CLI documentation
  - Fix project structure paths in SDK README

- [`c862869`](https://github.com/vultisig/vultisig-sdk/commit/c8628695cfc47209b26bfe628c9608d29c541a5b) - fix: npm package installation issues
  - Remove bundled internal packages (@core/_, @lib/_) from SDK dependencies - these are bundled into dist
  - Switch CLI build from tsc to esbuild for proper ESM compatibility
  - Update publish workflow to use `yarn npm publish` with --tolerate-republish
  - Require Node.js >= 20
