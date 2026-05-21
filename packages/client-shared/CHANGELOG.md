# @vultisig/client-shared

## 0.2.9

### Patch Changes

- Updated dependencies [[`c2fd086`](https://github.com/vultisig/vultisig-sdk/commit/c2fd08670ad67e9ec93443569f9b9b9aa5f9d685), [`1667b79`](https://github.com/vultisig/vultisig-sdk/commit/1667b79fbc754e36032942fb5e749706dfc09bf3), [`46274d7`](https://github.com/vultisig/vultisig-sdk/commit/46274d70fe19fb2f44bc90d9ec0cd4ac1994ae69), [`0c9f6d5`](https://github.com/vultisig/vultisig-sdk/commit/0c9f6d5139d4a096645a575505c7550c2b26bd2a)]:
  - @vultisig/sdk@0.25.0

## 0.2.8

### Patch Changes

- Updated dependencies [[`bd0daf9`](https://github.com/vultisig/vultisig-sdk/commit/bd0daf9a8156c9927643cba8c1af98a2a6d5da56), [`37c2f82`](https://github.com/vultisig/vultisig-sdk/commit/37c2f82379725ac4ac4d63679afea5c3ac1b7683)]:
  - @vultisig/sdk@0.24.0

## 0.2.7

### Patch Changes

- Updated dependencies [[`fde60dc`](https://github.com/vultisig/vultisig-sdk/commit/fde60dcc9f9822e21c2dbaeaacb9afb45cff0955), [`a6db82f`](https://github.com/vultisig/vultisig-sdk/commit/a6db82fd103ea8eea01a084cc8fbd787367db437)]:
  - @vultisig/sdk@0.23.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`feac01f`](https://github.com/vultisig/vultisig-sdk/commit/feac01f3225738a14c0123e1c3d70e46b97760fd), [`a3a331a`](https://github.com/vultisig/vultisig-sdk/commit/a3a331a875ebc6868b11c6901c8ed99dde51a4ff)]:
  - @vultisig/sdk@0.22.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`bad88d8`](https://github.com/vultisig/vultisig-sdk/commit/bad88d8d87229284c739995c027eb33d3ffc19e3)]:
  - @vultisig/sdk@0.21.0

## 0.2.4

### Patch Changes

- Updated dependencies [[`1d1c02c`](https://github.com/vultisig/vultisig-sdk/commit/1d1c02c37e58340b0617eec3a5e44909efc9b452)]:
  - @vultisig/sdk@0.20.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`c5f9c7b`](https://github.com/vultisig/vultisig-sdk/commit/c5f9c7bcac80d30f0b5e086c9e6860eaa0cf79a9)]:
  - @vultisig/sdk@0.19.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`2018787`](https://github.com/vultisig/vultisig-sdk/commit/2018787f8101ea9a98e975c0e7477245c3f86fad), [`f52057b`](https://github.com/vultisig/vultisig-sdk/commit/f52057b4af859018d1c180fa6db9ce15e153409f)]:
  - @vultisig/sdk@0.18.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`219cb00`](https://github.com/vultisig/vultisig-sdk/commit/219cb00898deeaac418945a89c1d243f25aae152)]:
  - @vultisig/sdk@0.17.0

## 0.2.0

### Minor Changes

- [#204](https://github.com/vultisig/vultisig-sdk/pull/204) [`0388700`](https://github.com/vultisig/vultisig-sdk/commit/03887009b7579fc0b193d068d4a205cdd3b7c214) Thanks [@premiumjibles](https://github.com/premiumjibles)! - feat(cli): agent-friendly CLI + new @vultisig/mcp package

  ## @vultisig/cli
  - Auto-TTY JSON output (`--output`, `--ci`, `--quiet`, `--fields`, `--non-interactive`)
  - Versioned `{ success, v: 1, data }` envelope and typed error envelope with exit codes 0-7
  - Safety: fixed `swap`/`send`/`execute`/`rujira swap`/`rujira withdraw` auto-executing in JSON mode; `--yes` now required uniformly
  - `--dry-run` coverage across all mutating commands
  - `vsig schema` machine-readable command introspection
  - Auth: replaced `keytar` with `@napi-rs/keyring`, encrypted-file fallback for headless environments (AES-256-GCM + async scrypt)

  ## @vultisig/client-shared (new package)

  Shared client infrastructure for `@vultisig/cli` and `@vultisig/mcp`: auth setup, config store, credential store (keyring + file fallback), tool descriptions, vault discovery.

  ## @vultisig/sdk
  - `VaultBase.send()` and `VaultBase.swap()` accept `amount: 'max'`
  - `SwapService` rejects quotes with near-zero output to guard against bad provider routes
  - `FiatValueService.fetchTokenPrice` returns `0` for non-EVM chains instead of throwing (effective behavior identical — `getPortfolioValue` already caught the throw)
  - `ServerManager`: removed stdout `console.log` calls that corrupted JSON output; raised `waitForPeers` timeout from 30s to 120s and tightened poll interval from 2s to 500ms

  ## @vultisig/core-chain
  - Narrowed EVM broadcast retry list to strings that genuinely indicate "same tx already in mempool under this hash" (`already known`, `transaction already exists`, `tx already in mempool`). Dropped strings that can silently swallow real broadcast failures (`nonce too low`, `transaction is temporarily banned`, `future transaction tries to replace pending`, `could not replace existing tx`)

  ## @vultisig/core-mpc
  - `maxInboundWaitTime` raised from 1 to 3 minutes for flaky networks
  - Added 100ms sleep in `processInbound` recursion to prevent hot-looping on empty inbound
  - Setup message polling: same 10-second budget, polls 5× more often (50 × 200ms vs 10 × 1000ms)

### Patch Changes

- Updated dependencies [[`0388700`](https://github.com/vultisig/vultisig-sdk/commit/03887009b7579fc0b193d068d4a205cdd3b7c214), [`83fe4c3`](https://github.com/vultisig/vultisig-sdk/commit/83fe4c3c58637aea4823d0eaa7f21d4c5cdf3dc7)]:
  - @vultisig/sdk@0.16.0
