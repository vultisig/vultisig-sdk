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

TypeScript under `packages/core/mpc/types/**` whose names end in `_pb.ts` is emitted by **protoc-gen-es**. Files under `packages/core/mpc/types/vultisig/**` come from `.proto` sources maintained in [vultisig/commondata](https://github.com/vultisig/commondata) (see each file's `@generated from file …` header and embedded `github.com/vultisig/commondata/go/...` module path). Files under `packages/core/mpc/types/plugin/**` currently come from [vultisig/recipes](https://github.com/vultisig/recipes) plugin policy protos and intentionally keep their `protoc-gen-es v2.10.2` headers. **Do not hand-edit those files**; change the upstream `.proto` and regenerate, then land the updated outputs in this repo.

Hand-written helpers for working with generated messages live under `packages/core/mpc/types/utils/` and are **not** `_pb.ts` outputs.

Regenerate the current outputs with:

```bash
git clone https://github.com/vultisig/commondata ../commondata
git clone https://github.com/vultisig/recipes ../recipes
COMMONDATA_DIR=../commondata RECIPES_DIR=../recipes yarn proto:regen:core-mpc
```

The script reads the existing `_pb.ts` headers as the manifest, probes common source layouts (`proto/`, `protos/`, and for recipes `types/`), and runs `buf generate` with the pinned `protoc-gen-es` version for each group. Generator upgrades are intentional: `packages/core/mpc/types/generatedProtobufHeaders.test.ts` pins the current version counts so accidental drift is visible in CI.

## Historical note

Older docs described a **`yarn sync-and-copy` workflow** that fetched `core/` and `lib/` from the Windows repo into an `upstream/` directory. That workflow has been **removed**; those trees now live only here.
