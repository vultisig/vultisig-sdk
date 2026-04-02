# Shared `packages/core` and `packages/lib`

Chain logic, MPC protocols, configuration, and WASM bindings live in this monorepo under `packages/core/` and `packages/lib/`. **The SDK is the source of truth** for that code. First-party apps (including the [vultisig-windows](https://github.com/vultisig/vultisig-windows) desktop and extension) consume it via published npm packages such as `@vultisig/core-chain`, `@vultisig/core-mpc`, `@vultisig/lib-*`, and `@vultisig/sdk`.

## Layout

```
vultisig-sdk/
├── packages/
│   ├── core/
│   │   ├── chain/     # @vultisig/core-chain — chain implementations
│   │   ├── mpc/       # @vultisig/core-mpc — MPC, vault, keysign
│   │   └── config/    # @vultisig/core-config — shared constants
│   ├── lib/
│   │   ├── utils/     # @vultisig/lib-utils
│   │   ├── dkls/      # @vultisig/lib-dkls (WASM)
│   │   ├── mldsa/     # @vultisig/lib-mldsa (WASM)
│   │   └── schnorr/   # @vultisig/lib-schnorr (WASM)
│   └── sdk/           # @vultisig/sdk — bundles workspace deps for distribution
```

## Contributing

Edit `packages/core/` and `packages/lib/` directly in this repository. Use workspace path aliases (`@vultisig/core-chain/*`, etc.) as elsewhere in the monorepo. After changes, run `yarn build:shared` (or the relevant package `build`) and tests before opening a PR.

## Historical note

Older docs described a **`yarn sync-and-copy` workflow** that fetched `core/` and `lib/` from the Windows repo into an `upstream/` directory. That workflow has been **removed**; those trees now live only here.
