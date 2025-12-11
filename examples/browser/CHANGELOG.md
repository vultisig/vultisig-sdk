# @vultisig/example-browser

## 0.1.2-alpha.1

### Patch Changes

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Update browser example and CLI for new fast vault creation API
  - Updated to use new `createFastVault()` that returns just the vaultId
  - Updated to use new `verifyVault()` that returns the FastVault
  - Removed `code` from CLI `CreateVaultOptions` (verification code always prompted interactively)
  - Removed `--code` option from CLI create command

- Updated dependencies [[`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c), [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c)]:
  - @vultisig/sdk@0.2.0-alpha.3

## 0.1.2-alpha.0

### Patch Changes

- Updated dependencies [[`cc96f64`](https://github.com/vultisig/vultisig-sdk/commit/cc96f64622a651eb6156f279afbbfe0aa4219179)]:
  - @vultisig/sdk@0.1.1-alpha.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`8694cd9`](https://github.com/vultisig/vultisig-sdk/commit/8694cd957573b8334ff0f29167f8b45c5140ce42), [`1f20084`](https://github.com/vultisig/vultisig-sdk/commit/1f20084bdaf6ddf00d2dd5c70ec6070e00a94e91), [`c862869`](https://github.com/vultisig/vultisig-sdk/commit/c8628695cfc47209b26bfe628c9608d29c541a5b)]:
  - @vultisig/sdk@0.1.0
