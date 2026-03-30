# @vultisig/core-chain

## 0.10.0

### Minor Changes

- [#149](https://github.com/vultisig/vultisig-sdk/pull/149) [`67dc6ce`](https://github.com/vultisig/vultisig-sdk/commit/67dc6ceaa1b318144cfbe3812ddecb14b108eba4) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Sync Windows-style TSS batching: batched FastVault APIs (`/batch/keygen`, `/batch/import`, `/batch/reshare`), batched relay message IDs for ECDSA, EdDSA, MLDSA, and per-chain import, secure vault QR `tssBatching=1` for joiner alignment, sequential fallbacks, and test coverage.

### Patch Changes

- Updated dependencies [[`67dc6ce`](https://github.com/vultisig/vultisig-sdk/commit/67dc6ceaa1b318144cfbe3812ddecb14b108eba4)]:
  - @vultisig/core-mpc@0.10.0

## 0.9.0

### Minor Changes

- [#147](https://github.com/vultisig/vultisig-sdk/pull/147) [`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Publish shared chain, MPC, config, and lib packages to npm with compiled `dist/` output, deep subpath exports, and release workflow updates. SDK declares these packages as dependencies; `@vultisig/cli` is versioned with the SDK via changesets link.

### Patch Changes

- Updated dependencies [[`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8)]:
  - @vultisig/core-config@0.9.0
  - @vultisig/core-mpc@0.9.0
  - @vultisig/lib-utils@0.9.0
