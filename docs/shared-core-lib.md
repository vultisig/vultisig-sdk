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

## Generated protobuf (`packages/core/mpc/types/**/*_pb.ts`)

TypeScript under `packages/core/mpc/types/**` whose names end in `_pb.ts` is emitted by **protoc-gen-es** from `.proto` sources maintained in [vultisig/commondata](https://github.com/vultisig/commondata) (see each file's `@generated from file …` header and the embedded `github.com/vultisig/commondata/go/...` module path in generated descriptors). **Do not hand-edit those files**; change the upstream `.proto` and regenerate, then land the updated outputs in this repo.

Hand-written helpers for working with generated messages live under `packages/core/mpc/types/utils/` and are **not** `_pb.ts` outputs.

There is **no** checked-in buf/protoc wrapper script in this repository today; generator upgrades are intentional (the test `generatedProtobufHeaders.test.ts` pins current `protoc-gen-es` version groups so accidental drift is visible in CI).

## Historical note

Older docs described a **`yarn sync-and-copy` workflow** that fetched `core/` and `lib/` from the Windows repo into an `upstream/` directory. That workflow has been **removed**; those trees now live only here.
