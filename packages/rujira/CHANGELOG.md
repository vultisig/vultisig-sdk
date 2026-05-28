# @vultisig/rujira

## 28.0.0

### Patch Changes

- Updated dependencies [[`5bb56a4`](https://github.com/vultisig/vultisig-sdk/commit/5bb56a4daba8b896626c54fabd94fd6c9a35320e), [`a13c644`](https://github.com/vultisig/vultisig-sdk/commit/a13c644be796a7bf10dc0ab426ac888b9e962585), [`3eb9b18`](https://github.com/vultisig/vultisig-sdk/commit/3eb9b186b0d021455cf47f957b15a45fcbb2798e), [`5d11cf3`](https://github.com/vultisig/vultisig-sdk/commit/5d11cf3bfb81aba929fe8e81bb77e7aebff15129)]:
  - @vultisig/sdk@1.4.0

## 27.0.0

### Patch Changes

- Updated dependencies [[`c1cca9a`](https://github.com/vultisig/vultisig-sdk/commit/c1cca9aa88acef2c0b31884154af2ed1e6b8ff92), [`f2270cd`](https://github.com/vultisig/vultisig-sdk/commit/f2270cd6aaa741d6800bd2d21e9775092be25d31)]:
  - @vultisig/sdk@1.3.0

## 26.0.0

### Patch Changes

- Updated dependencies [[`cc9d67f`](https://github.com/vultisig/vultisig-sdk/commit/cc9d67f0c61d9ebdfc133beac5ef04658d37a37f)]:
  - @vultisig/sdk@1.2.0

## 25.0.0

### Patch Changes

- Updated dependencies [[`5ef62f1`](https://github.com/vultisig/vultisig-sdk/commit/5ef62f1aa20202f4a4eb97afa0cf20216dc5a1f1)]:
  - @vultisig/sdk@1.1.0

## 24.0.0

### Patch Changes

- Updated dependencies [[`fa95600`](https://github.com/vultisig/vultisig-sdk/commit/fa95600887cb8ca603e8ddcb9c8558eff2d0ea6b)]:
  - @vultisig/sdk@1.0.0

## 23.0.0

### Patch Changes

- Updated dependencies [[`cb21dcf`](https://github.com/vultisig/vultisig-sdk/commit/cb21dcf127e8e08ceaca76439fa28d557cf0fed9)]:
  - @vultisig/sdk@0.28.0

## 22.0.0

### Patch Changes

- Updated dependencies [[`9a80907`](https://github.com/vultisig/vultisig-sdk/commit/9a8090721008f2a10dffa9cf2d3fac479d65481c)]:
  - @vultisig/sdk@0.27.0

## 21.0.0

### Patch Changes

- Updated dependencies [[`cb80440`](https://github.com/vultisig/vultisig-sdk/commit/cb804408b9607aacb143a7a941f0f9f1986f2379)]:
  - @vultisig/sdk@0.26.0

## 20.0.0

### Patch Changes

- Updated dependencies [[`c2fd086`](https://github.com/vultisig/vultisig-sdk/commit/c2fd08670ad67e9ec93443569f9b9b9aa5f9d685), [`1667b79`](https://github.com/vultisig/vultisig-sdk/commit/1667b79fbc754e36032942fb5e749706dfc09bf3), [`46274d7`](https://github.com/vultisig/vultisig-sdk/commit/46274d70fe19fb2f44bc90d9ec0cd4ac1994ae69), [`0c9f6d5`](https://github.com/vultisig/vultisig-sdk/commit/0c9f6d5139d4a096645a575505c7550c2b26bd2a)]:
  - @vultisig/sdk@0.25.0

## 19.0.0

### Patch Changes

- Updated dependencies [[`bd0daf9`](https://github.com/vultisig/vultisig-sdk/commit/bd0daf9a8156c9927643cba8c1af98a2a6d5da56), [`37c2f82`](https://github.com/vultisig/vultisig-sdk/commit/37c2f82379725ac4ac4d63679afea5c3ac1b7683)]:
  - @vultisig/sdk@0.24.0

## 18.0.0

### Patch Changes

- Updated dependencies [[`fde60dc`](https://github.com/vultisig/vultisig-sdk/commit/fde60dcc9f9822e21c2dbaeaacb9afb45cff0955), [`a6db82f`](https://github.com/vultisig/vultisig-sdk/commit/a6db82fd103ea8eea01a084cc8fbd787367db437)]:
  - @vultisig/sdk@0.23.0

## 17.0.1

### Patch Changes

- [#383](https://github.com/vultisig/vultisig-sdk/pull/383) [`745172f`](https://github.com/vultisig/vultisig-sdk/commit/745172f3ee511bc4e95914986bfbdb8acf794b1e) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Migrate THORChain Midgard, THORNode REST, and Tendermint RPC endpoints from the legacy `*.thorchain.network` hosts to the Liquify gateway (`gateway.liquify.com/chain/thorchain_midgard`, `…/thorchain_api`, `…/thorchain_rpc`). Updated `cosmosRpcUrl.THORChain`, `tendermintRpcUrl.THORChain`, `thorchainMidgardBaseUrl`, and the rujira `MAINNET_CONFIG` endpoints accordingly.

  In `RujiraDiscovery.discoverViaChain()`, replaced the brittle `rpc → thornode` string substitution with a direct read of `MAINNET_CONFIG.restEndpoint`. Under the new gateway routing the substitution silently produced an invalid host (`thorchain_thornode`) and the fallback branch was unreachable. Removed the now-unused `rpcEndpoint` option from `DiscoveryOptions` and the corresponding plumbing in `RujiraClient`.

## 17.0.0

### Patch Changes

- Updated dependencies [[`feac01f`](https://github.com/vultisig/vultisig-sdk/commit/feac01f3225738a14c0123e1c3d70e46b97760fd), [`a3a331a`](https://github.com/vultisig/vultisig-sdk/commit/a3a331a875ebc6868b11c6901c8ed99dde51a4ff)]:
  - @vultisig/sdk@0.22.0

## 16.0.0

### Patch Changes

- Updated dependencies [[`bad88d8`](https://github.com/vultisig/vultisig-sdk/commit/bad88d8d87229284c739995c027eb33d3ffc19e3)]:
  - @vultisig/sdk@0.21.0

## 15.0.0

### Patch Changes

- Updated dependencies [[`1d1c02c`](https://github.com/vultisig/vultisig-sdk/commit/1d1c02c37e58340b0617eec3a5e44909efc9b452)]:
  - @vultisig/sdk@0.20.0

## 14.0.0

### Patch Changes

- Updated dependencies [[`c5f9c7b`](https://github.com/vultisig/vultisig-sdk/commit/c5f9c7bcac80d30f0b5e086c9e6860eaa0cf79a9)]:
  - @vultisig/sdk@0.19.0

## 13.0.0

### Major Changes

- [#299](https://github.com/vultisig/vultisig-sdk/pull/299) [`4af5bb8`](https://github.com/vultisig/vultisig-sdk/commit/4af5bb8043da7dab15b5e1a135e5195d2dd1d7cc) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat(rujira)!: drop RujiraPerps

  **BREAKING CHANGE.** The `RujiraPerps` module is removed. Its only
  consumer was vultisig-mcp-ts' `src/tools/rujira/perps.ts`, which
  [mcp-ts#36](https://github.com/vultisig/mcp-ts/pull/36) deleted
  (commit `e5ecb58`). No known external consumers.

  Removed:
  - `RujiraPerps` class export
  - `PerpsMarket` type export
  - `PerpsTransactionParams` type export
  - `client.perps` field on `RujiraClient`
  - `@vultisig/rujira/perps` subpath export

  No replacement API. Consumers that still need perps-style interactions
  should open an issue — the module was a thin wrapper around on-chain
  calls that can be reconstructed if there's demand.

  All other Rujira surfaces (swap, orderbook, staking, ghost, deposit,
  withdraw, discovery) are unchanged.

### Patch Changes

- Updated dependencies [[`2018787`](https://github.com/vultisig/vultisig-sdk/commit/2018787f8101ea9a98e975c0e7477245c3f86fad), [`f52057b`](https://github.com/vultisig/vultisig-sdk/commit/f52057b4af859018d1c180fa6db9ce15e153409f)]:
  - @vultisig/sdk@0.18.0

## 12.1.0

### Minor Changes

- [#300](https://github.com/vultisig/vultisig-sdk/pull/300) [`2da432d`](https://github.com/vultisig/vultisig-sdk/commit/2da432d3e972802ee246584971c5abca05b49797) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat(rujira): CCL (Custom Concentrated Liquidity) support

  Rujira shipped [Custom Concentrated Liquidity](https://rujira.network/trade) on RUJI Trade
  on 2026-04-20. This release adds SDK support for range-position management on
  `rujira-fin` pair contracts via a new `range` ExecuteMsg variant.

  New surface:
  - **`client.range: RujiraRange`** — pure builders (no signer needed):
    - `buildCreatePosition({ pairAddress, config, base, quote })`
    - `buildDeposit({ pairAddress, idx, base, quote })`
    - `buildWithdraw({ pairAddress, idx, share })`
    - `buildClaim({ pairAddress, idx })`
    - `buildTransfer({ pairAddress, idx, to })`
    - `buildWithdrawAll({ pairAddress, idx })` — returns `RangeMultiTransactionParams`
      with `[claim, withdraw('1')]`. Callers MUST sign + broadcast both msgs in a
      single cosmos tx for atomicity (`wasm_execute_multi`).
  - **GraphQL helpers** (against `api.vultisig.com/ruji/api/graphql`):
    - `client.range.getPositions(owner)` — list all range positions
    - `client.range.getPosition(pairAddress, idx)` — single position analytics
    - `client.range.getPairAddress(base, quote)` — resolve FIN pair contract
      from tickers / denoms (exact-match preferred, single-candidate fuzzy
      match fallback; ambiguous hits throw `INVALID_PARAMS`)
  - **`@vultisig/rujira/ccl` subpath export** — CCL math module ported from
    rujira-ui (MIT): linear + quadratic weight models, √price Newton-Raphson
    price recovery, bucket distribution generator. 90 tests pass.
  - **`@vultisig/rujira/range` subpath export** — just the RujiraRange class
    - types for consumers that want to avoid pulling the full entry point.
  - **`RujiraErrorCode.INVALID_PARAMS`** — new error code for the input
    validation surface (Decimal12 for config fields, Decimal4 + `(0, 1]` for
    withdraw share, `idx` strictly `/^\d+$/`, `thor1` prefix on pair addresses).

  No change to existing `swap` / `orderbook` / `staking` / `ghost` / `deposit` /
  `withdraw` / `discovery` surfaces.

### Patch Changes

- Updated dependencies []:
  - @vultisig/sdk@0.17.1

## 12.0.0

### Patch Changes

- Updated dependencies [[`219cb00`](https://github.com/vultisig/vultisig-sdk/commit/219cb00898deeaac418945a89c1d243f25aae152)]:
  - @vultisig/sdk@0.17.0

## 11.0.0

### Patch Changes

- Updated dependencies [[`0388700`](https://github.com/vultisig/vultisig-sdk/commit/03887009b7579fc0b193d068d4a205cdd3b7c214), [`83fe4c3`](https://github.com/vultisig/vultisig-sdk/commit/83fe4c3c58637aea4823d0eaa7f21d4c5cdf3dc7)]:
  - @vultisig/sdk@0.16.0

## 10.0.0

### Patch Changes

- Updated dependencies [[`9f71a0e`](https://github.com/vultisig/vultisig-sdk/commit/9f71a0e430aadcb96707448c5e5e077aa0b561e0), [`aea1c28`](https://github.com/vultisig/vultisig-sdk/commit/aea1c28051345ddef9c952108b203caa8b7fa032)]:
  - @vultisig/sdk@0.15.0

## 9.0.0

### Patch Changes

- Updated dependencies [[`9e2ffd6`](https://github.com/vultisig/vultisig-sdk/commit/9e2ffd6f6a8e2c8ad507b6ed2e2c1232bf8a98c7), [`8bef556`](https://github.com/vultisig/vultisig-sdk/commit/8bef55651cba506a515083765d6f7745cce54abe), [`99296f5`](https://github.com/vultisig/vultisig-sdk/commit/99296f5aaf3f9bfb7fe694de034037683e7435ed)]:
  - @vultisig/sdk@0.14.0

## 8.0.0

### Patch Changes

- Updated dependencies [[`4195641`](https://github.com/vultisig/vultisig-sdk/commit/4195641a9eb27d41fb27d2c6b605b34d4c4635b0)]:
  - @vultisig/sdk@0.12.0

## 7.0.0

### Patch Changes

- Updated dependencies [[`5286b98`](https://github.com/vultisig/vultisig-sdk/commit/5286b98d19692acd216a2c95d5a7a903217bef36)]:
  - @vultisig/sdk@0.11.0

## 6.0.0

### Patch Changes

- Updated dependencies [[`67dc6ce`](https://github.com/vultisig/vultisig-sdk/commit/67dc6ceaa1b318144cfbe3812ddecb14b108eba4)]:
  - @vultisig/sdk@0.10.0

## 5.0.0

### Patch Changes

- Updated dependencies [[`75cf69f`](https://github.com/vultisig/vultisig-sdk/commit/75cf69f24cee843f9b508cc370c105e6339f01a8), [`60c1be9`](https://github.com/vultisig/vultisig-sdk/commit/60c1be943599c1d41dd2b6110dae05a40d50f74e), [`813b160`](https://github.com/vultisig/vultisig-sdk/commit/813b16058c816853ed18a82dcc8b967047c46b50), [`813b160`](https://github.com/vultisig/vultisig-sdk/commit/813b16058c816853ed18a82dcc8b967047c46b50), [`813b160`](https://github.com/vultisig/vultisig-sdk/commit/813b16058c816853ed18a82dcc8b967047c46b50), [`813b160`](https://github.com/vultisig/vultisig-sdk/commit/813b16058c816853ed18a82dcc8b967047c46b50), [`b8770b3`](https://github.com/vultisig/vultisig-sdk/commit/b8770b33b3c38f3bd676e16e7c26f1464bb28548), [`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8)]:
  - @vultisig/sdk@0.9.0

## 4.0.0

### Patch Changes

- Updated dependencies [[`da88c6f`](https://github.com/vultisig/vultisig-sdk/commit/da88c6f06b8d74ccb5642f793e386d85ff6f30b1), [`4b29636`](https://github.com/vultisig/vultisig-sdk/commit/4b29636514edccf0980eddf5e8fffacfcb31c88f), [`7677523`](https://github.com/vultisig/vultisig-sdk/commit/76775232866dccf4e1e85aa0fe0d91c2fd8fdddb)]:
  - @vultisig/sdk@0.8.0

## 3.0.0

### Patch Changes

- Updated dependencies [[`da68dda`](https://github.com/vultisig/vultisig-sdk/commit/da68dda0622a024af35666bb7b7088dea4cf3cfd)]:
  - @vultisig/sdk@0.7.0

## 2.0.0

### Patch Changes

- [#107](https://github.com/vultisig/vultisig-sdk/pull/107) [`117cd70`](https://github.com/vultisig/vultisig-sdk/commit/117cd705271305269acce5436a2845decd98dc90) Thanks [@vultisigsdkbot](https://github.com/vultisigsdkbot)! - Fix price impact calculation returning hardcoded 50% for small trades on deep pairs
  - Remove hardcoded 50% cap on price impact values
  - Add bidirectional price comparison to handle both swap directions correctly
    (buying base vs selling base relative to orderbook convention)
  - Return 'unknown' instead of guessed ranges when orderbook data is unavailable
  - Return 'unknown' when calculated impact exceeds 99% (likely unit mismatch)

- Updated dependencies [[`355c700`](https://github.com/vultisig/vultisig-sdk/commit/355c700e7caca812199fafceb3767b8b3c5fd236), [`78f8bd2`](https://github.com/vultisig/vultisig-sdk/commit/78f8bd237dc3ca6f42dd268d069ed8f7902e733b), [`26d3cae`](https://github.com/vultisig/vultisig-sdk/commit/26d3cae3066a316d1e9429a2664a6b4ea18dd8a2), [`2ed545f`](https://github.com/vultisig/vultisig-sdk/commit/2ed545fb20f5920cb70d096076d55756cea222aa), [`a2d545b`](https://github.com/vultisig/vultisig-sdk/commit/a2d545b96794cce087eb4ea8ce955db20212c926), [`f5176ba`](https://github.com/vultisig/vultisig-sdk/commit/f5176ba4a9fda2c82b6264a958d61d5170e3d2cd)]:
  - @vultisig/sdk@0.6.0

## 1.0.0

### Minor Changes

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`75f441c`](https://github.com/vultisig/vultisig-sdk/commit/75f441cdf711e6ba04eed412dcf34002c5705144) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add Rujira DEX integration with FIN order book swaps, secured asset deposits/withdrawals, and CLI commands. New package: @vultisig/rujira for THORChain DEX operations (includes asset registry).

### Patch Changes

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`e172aff`](https://github.com/vultisig/vultisig-sdk/commit/e172aff35aff86d182646a521dc1e3ac9e381f60) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: address PR review bugs and safety issues
  - Fix missing ChromeExtensionPolyfills import causing build failure
  - Fix floating-point precision loss in CLI amount parsing for high-decimal tokens
  - Fix BigInt crash on non-integer amount strings in swap validation
  - Fix Number exponentiation precision loss in VaultSend formatAmount
  - Use VaultError with error codes in chain validation instead of generic Error
  - Add chainId mismatch validation in signAndBroadcast
  - Add hex string input validation in hexDecode
  - Guard against empty accounts array in client getAddress
  - Use stricter bech32 THORChain address validator in deposit module

- Updated dependencies [[`bd543af`](https://github.com/vultisig/vultisig-sdk/commit/bd543af73a50a4ce431f38e3ed77511c4ef65ea7), [`74516fa`](https://github.com/vultisig/vultisig-sdk/commit/74516fae8dabd844c9e0793b932f6284ce9aa009), [`7ceab79`](https://github.com/vultisig/vultisig-sdk/commit/7ceab79e53986bfefa3f5d4cb5d25855572fbd3f), [`cd57d64`](https://github.com/vultisig/vultisig-sdk/commit/cd57d6482e08bd6172550ec4eea0e0233abd7f76), [`e172aff`](https://github.com/vultisig/vultisig-sdk/commit/e172aff35aff86d182646a521dc1e3ac9e381f60), [`ea1e8d5`](https://github.com/vultisig/vultisig-sdk/commit/ea1e8d5dd14a7273021577471e44719609f983ca), [`3f5fdcb`](https://github.com/vultisig/vultisig-sdk/commit/3f5fdcbfbe23aa287dfbcb38e9be6c904af9caf0), [`6c5c77c`](https://github.com/vultisig/vultisig-sdk/commit/6c5c77ceb49620f711285effee98b052e6aab1f8)]:
  - @vultisig/sdk@0.5.0
