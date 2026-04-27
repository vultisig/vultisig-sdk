# @vultisig/mpc-wasm

## 0.1.4

### Patch Changes

- Updated dependencies [[`e3fa32b`](https://github.com/vultisig/vultisig-sdk/commit/e3fa32b9f29e3a07880ecba117cf40e6dd396a4b)]:
  - @vultisig/mpc-types@0.2.2

## 0.1.3

### Patch Changes

- Updated dependencies [[`54731db`](https://github.com/vultisig/vultisig-sdk/commit/54731dbc0ded30adc7f76bbc5e3e532ef9414bb2)]:
  - @vultisig/mpc-types@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [[`78772fd`](https://github.com/vultisig/vultisig-sdk/commit/78772fd061f3061c54802506218e5524a21714bd)]:
  - @vultisig/mpc-types@0.2.0

## 0.1.1

### Patch Changes

- [#257](https://github.com/vultisig/vultisig-sdk/pull/257) [`665cf03`](https://github.com/vultisig/vultisig-sdk/commit/665cf037951df40dc35068463c4ddd299cec20dd) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - chore: republish with `dist/` included

  Both packages are currently broken on npm — the `0.1.1` and `0.1.0` tarballs respectively ship only `src/` and the publish runner didn't have `dist/` at the time they were cut, so `files: ["dist", "src"]` silently dropped the missing pattern. Consumers of `@vultisig/mpc-types` and `@vultisig/mpc-wasm` from npm hit `Cannot find module 'dist/index.js'` at runtime. [vultisig-sdk#255](https://github.com/vultisig/vultisig-sdk/pull/255) fixed the CI artifact pipeline; this changeset triggers a patch bump so the next release cycle actually republishes them with `dist/` present.

- Updated dependencies [[`665cf03`](https://github.com/vultisig/vultisig-sdk/commit/665cf037951df40dc35068463c4ddd299cec20dd)]:
  - @vultisig/mpc-types@0.1.2
