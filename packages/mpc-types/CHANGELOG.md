# @vultisig/mpc-types

## 0.2.0

### Minor Changes

- [`78772fd`](https://github.com/vultisig/vultisig-sdk/commit/78772fd061f3061c54802506218e5524a21714bd) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix MPC engine singleton so direct `@vultisig/core-mpc` / `@vultisig/mpc-types` / `@vultisig/mpc-wasm` imports register correctly across bundler chunks and Vite `optimizeDeps` scenarios.
  - Runtime singletons (MPC engine, WASM WalletCore getter, default storage factory, platform crypto) now live in a `globalThis`-anchored store keyed by `Symbol.for('vultisig.runtime.store.v1')`, eliminating duplicate-module-instance bugs.
  - `ensureMpcEngine()` added (async) — lazily registers the default `WasmMpcEngine` when no engine has been configured, so consumers that import only `@vultisig/core-mpc` no longer need to bootstrap the SDK.
  - `@vultisig/sdk` `sideEffects` narrowed from `false` to an allowlist of platform entry dist files, preventing tree-shakers from dropping the platform bootstrap.
  - `@vultisig/mpc-wasm` declared as an optional peer dependency of `@vultisig/mpc-types`.

  Closes [#287](https://github.com/vultisig/vultisig-sdk/issues/287).

### Patch Changes

- Updated dependencies []:
  - @vultisig/mpc-wasm@0.1.2

## 0.1.2

### Patch Changes

- [#257](https://github.com/vultisig/vultisig-sdk/pull/257) [`665cf03`](https://github.com/vultisig/vultisig-sdk/commit/665cf037951df40dc35068463c4ddd299cec20dd) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - chore: republish with `dist/` included

  Both packages are currently broken on npm — the `0.1.1` and `0.1.0` tarballs respectively ship only `src/` and the publish runner didn't have `dist/` at the time they were cut, so `files: ["dist", "src"]` silently dropped the missing pattern. Consumers of `@vultisig/mpc-types` and `@vultisig/mpc-wasm` from npm hit `Cannot find module 'dist/index.js'` at runtime. [vultisig-sdk#255](https://github.com/vultisig/vultisig-sdk/pull/255) fixed the CI artifact pipeline; this changeset triggers a patch bump so the next release cycle actually republishes them with `dist/` present.
