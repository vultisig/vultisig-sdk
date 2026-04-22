# @vultisig/mpc-types

## 0.2.1

### Patch Changes

- [#298](https://github.com/vultisig/vultisig-sdk/pull/298) [`54731db`](https://github.com/vultisig/vultisig-sdk/commit/54731dbc0ded30adc7f76bbc5e3e532ef9414bb2) Thanks [@rcoderdev](https://github.com/rcoderdev)! - chore(mpc-types): guard MPC runtime singleton — duplicate-engine detector + ESLint rule

  Preventive mechanism for the bug class captured in vultisig/vultisig-windows#3777 (MPC engine singleton broken across bundler chunks). The globalThis-backed `runtimeStore` already neutralises chunking; this change adds two independent guardrails so the footgun can't return quietly.
  - `configureMpc` now detects when it is called with a _different_ engine instance after an engine has already been registered. Same-reference second calls stay a no-op (expected when cross-chunk reloads share the `globalThis` store). Different-instance second calls log an actionable `console.error` with constructor names, stable non-enumerable instance IDs, and a stack-frame call-site hint, then throw in dev.
  - New env var `VULTISIG_STRICT_SINGLETON` — set to `1` to force the throw in production, or `0` to suppress the throw in dev. Default is **strict** whenever `NODE_ENV` is not explicitly `'production'`, which fixes the plain-ESM browser case where `process` is undefined (previously went silent, hiding duplicates in exactly the environment the original bug surfaced in).
  - ESLint `no-restricted-syntax` rule applied to `packages/mpc-types/src/**` and `packages/core/mpc/**`: bans module-level `let` and `export let`. The original bug had the exact shape `let engine: ... | null = null`. Opt-out with `// eslint-disable-next-line no-restricted-syntax -- vultisig-singleton-ok: <reason>`.

  Behaviour in production (`NODE_ENV === 'production'`) is unchanged for single-engine consumers: still warns and overwrites on duplicates. The new throw path only engages in dev / test / unknown environments, or when explicitly opted into via `VULTISIG_STRICT_SINGLETON=1`.

- Updated dependencies []:
  - @vultisig/mpc-wasm@0.1.3

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
