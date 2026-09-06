# @vultisig/lib-utils

## 0.10.6

### Patch Changes

- [#2023](https://github.com/vultisig/vultisig-sdk/pull/2023) [`3203589`](https://github.com/vultisig/vultisig-sdk/commit/3203589af5da361dfc51695aad4fef77afa2d78e) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(encoding): bound TRON/Solana/Ripple fee-and-gas fields before `Long.fromString`

  `Long.fromString` (and `BigInt()`) silently two's-complement-wraps an out-of-range magnitude instead of throwing (e.g. `2^64 -> 0`, `2^63 -> -2^63`). Six fee/gas sites fed by third-party gas estimation / swap-aggregator data routed raw values straight into it with no bound - a wrapped TRON `feeLimit`/`callValue`/`callTokenValue` could authorize an outsized fee burn, and a wrapped Solana priority fee or Ripple network fee misprices the transaction:

  - `packages/core/mpc/keysign/signingInputs/resolvers/tron.ts` - `feeLimit` (4 sites, from `tronSpecific.gasEstimation`), `callValue`, `callTokenValue`
  - `packages/core/mpc/keysign/signingInputs/resolvers/solana/send.ts` - `priorityFee`
  - `packages/core/mpc/keysign/signingInputs/resolvers/ripple.ts` - `fee` (from `rippleSpecific.gas`)

  New `assertBoundedInt(value, 'int64' | 'uint64')` in `@vultisig/lib-utils/bigint/assertBoundedInt` validates a decimal integer string against the proto field's declared 64-bit range and throws instead of letting the wrap happen, matching each field's real signedness (TRON's are `int64`, Solana's priority fee is `uint64`, Ripple's fee is `int64`). In-range values are unaffected - this is fail-closed only.

## 0.10.5

### Patch Changes

- [#1515](https://github.com/vultisig/vultisig-sdk/pull/1515) [`69b1c2e`](https://github.com/vultisig/vultisig-sdk/commit/69b1c2e4026e62a83151957a91651eaa982d0a13) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Centralize the race-safe `memoizeAsync` implementation in `@vultisig/lib-utils`, and update the SDK browser/chrome-extension runtimes to consume the shared helper so concurrent initialization work shares in-flight promises instead of duplicating async setup.

## 0.10.4

### Patch Changes

- [#918](https://github.com/vultisig/vultisig-sdk/pull/918) [`6302825`](https://github.com/vultisig/vultisig-sdk/commit/63028250c7a17bf165046f0bb0c2263354dab66a) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Show tiny fiat amounts (e.g. LUNC-style prices below one cent) with significant
  digits and compact subscript notation instead of rounding them to "$0.00"
  (e.g. 0.00000003 now renders as $0.0₇3).

## 0.10.3

### Patch Changes

- [#880](https://github.com/vultisig/vultisig-sdk/pull/880) [`2ff65f3`](https://github.com/vultisig/vultisig-sdk/commit/2ff65f31bbbf64919c456e05dc6d274625127c2e) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Add a 20s default deadline to `queryUrl` (the shared HTTP helper behind
  prices/balances/swap quotes/broadcast/MPC-server calls). An unbounded `fetch`
  against a hung upstream previously wedged the caller forever — a stalled
  `/coingeicko` price proxy made `fiatToAmount -> execute_send` hang and
  perma-loaded the agent send card's "Network fee" row until the app's own 60s
  build-timeout fired. The deadline is implemented with a Hermes-compatible
  `AbortController` + `setTimeout` and only applies when the caller passes no
  `signal`; callers that supply their own `signal` keep owning cancellation. A
  new `timeoutMs` option lets callers override the default.

## 0.10.2

### Patch Changes

- [#788](https://github.com/vultisig/vultisig-sdk/pull/788) [`b51902b`](https://github.com/vultisig/vultisig-sdk/commit/b51902bc08045e3977116565e430c1454d0ba607) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Make `getUrlBaseDomain` resolve the registrable (eTLD+1) domain using the Public Suffix List instead of taking the last two hostname labels. Sites under multi-label public suffixes (`*.vercel.app`, `*.github.io`, `*.pages.dev`, `*.web.app`, `*.co.uk`, …) now resolve to distinct domains, so a connection authorized for one site is no longer treated as authorized for an unrelated sibling under the same suffix.

## 0.10.1

### Patch Changes

- [#361](https://github.com/vultisig/vultisig-sdk/pull/361) [`a52980c`](https://github.com/vultisig/vultisig-sdk/commit/a52980c490633da7d7ae36128bc491f8ca3ff565) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Build shared workspace packages before bundling the SDK (`yarn build:sdk`). The browser example prepare step now rebuilds shared `dist` outputs when missing or stale, and shared utilities now import `Buffer` explicitly so browser apps do not crash during module evaluation.

## 0.10.0

### Minor Changes

- [#293](https://github.com/vultisig/vultisig-sdk/pull/293) [`a3a331a`](https://github.com/vultisig/vultisig-sdk/commit/a3a331a875ebc6868b11c6901c8ed99dde51a4ff) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Password-protected vault backups use PBKDF2-HMAC-SHA256 with a random salt (600k iterations by default) and a versioned blob prefix; legacy SHA-256-only backups still decrypt.

## 0.9.3

### Patch Changes

- [#280](https://github.com/vultisig/vultisig-sdk/pull/280) [`5aef564`](https://github.com/vultisig/vultisig-sdk/commit/5aef564309aeeede5da250e03447e0a3da0a12ab) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add THORChain LP agent actions (`thorchain_pool_info`, `thorchain_add_liquidity`, `thorchain_remove_liquidity`) to the CLI executor and document them in AGENTS.md. Fix `@vultisig/lib-utils` ESM imports to directory entrypoints so Node resolves `dist` correctly.

## 0.9.2

### Patch Changes

- [#295](https://github.com/vultisig/vultisig-sdk/pull/295) [`ed1eb16`](https://github.com/vultisig/vultisig-sdk/commit/ed1eb16b868176b796629e10de95fddcf701c151) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Re-publish `@vultisig/lib-utils` with the emitted `dist/` regenerated by the
  hardened `scripts/fix-dist-esm-relative-imports.mjs` from [#290](https://github.com/vultisig/vultisig-sdk/issues/290).

  The ESM relative-import rewriter shipped in [#290](https://github.com/vultisig/vultisig-sdk/issues/290) only re-emits `dist/` when the
  owning package is bumped, but [#290](https://github.com/vultisig/vultisig-sdk/issues/290)'s changeset did not include a bump for
  `@vultisig/lib-utils`. As a result, the currently-published
  `@vultisig/lib-utils@0.9.1` on npm still carries 15 pre-fix imports that
  extension-append `.js` to directory modules, e.g.
  `from '../error/extractErrorMsg.js'` where the target is
  `../error/extractErrorMsg/index.js`. This surfaces to downstream consumers
  (starting from `@vultisig/core-mpc` and `@vultisig/sdk@0.16.0`) as
  `ERR_MODULE_NOT_FOUND` under strict ESM loaders, breaking Node-side flows such
  as the desktop/extension co-signer.

  The package source is unchanged; this patch exists solely to trigger a
  `changeset:publish` run so the regenerated `dist/` ships.

## 0.9.1

### Patch Changes

- [#157](https://github.com/vultisig/vultisig-sdk/pull/157) [`5286b98`](https://github.com/vultisig/vultisig-sdk/commit/5286b98d19692acd216a2c95d5a7a903217bef36) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Regenerate explicit `package.json` exports for `@vultisig/core-config` and `@vultisig/lib-utils` so directory and flat subpaths resolve under Node, TypeScript, and Vite.

  **Breaking (`@vultisig/core-chain`, `@vultisig/core-mpc`):** Remove the npm dependency cycle by dropping `@vultisig/core-mpc` from `core-chain`. Modules that required MPC types or keysign helpers now live under `@vultisig/core-mpc` (for example `tx/compile/compileTx`, `tx/preSigningHashes`, `chains/cosmos/qbtc/QBTCHelper`, Blockaid keysign input builders, `swap/native/utils/nativeSwapQuoteToSwapPayload`, `swap/utils/getSwapTrackingUrl`, and EVM `incrementKeysignPayloadNonce` at `keysign/signingInputs/resolvers/evm/incrementKeysignPayloadNonce`). `getUtxos` / `getCardanoUtxos` return plain `ChainPlainUtxo`; keysign maps to protobuf in MPC.

  **SDK:** QBTC support, shared import updates, and alignment with the new package boundaries.

## 0.9.0

### Minor Changes

- [#147](https://github.com/vultisig/vultisig-sdk/pull/147) [`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Publish shared chain, MPC, config, and lib packages to npm with compiled `dist/` output, deep subpath exports, and release workflow updates. SDK declares these packages as dependencies; `@vultisig/cli` is versioned with the SDK via changesets link.
