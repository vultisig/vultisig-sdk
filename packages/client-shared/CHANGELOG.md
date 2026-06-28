# @vultisig/client-shared

## 0.2.17

### Patch Changes

- [#878](https://github.com/vultisig/vultisig-sdk/pull/878) [`26dd218`](https://github.com/vultisig/vultisig-sdk/commit/26dd218282b198fdea9c1118e7fe5bc800c071fb) Thanks [@neavra](https://github.com/neavra)! - Harden the vault-registry config store (`config-store.ts`):

  - `loadConfig` now warns to stderr (naming the path and parse error) when
    `config.json` is corrupted instead of silently reverting to an empty
    registry, and leaves the bad file intact at load time (the next saveConfig
    still overwrites it once the user mutates state — this is not durable
    recovery). A missing file is still treated as the normal first-run case (no
    warning).
  - `saveConfig` now writes `config.json` with `0o600` perms (and `chmod`s on
    every write, since the mode is only honored on create) and creates the
    config dir with `0o700`, mirroring credential-store's hardening.

- Updated dependencies [[`69bb830`](https://github.com/vultisig/vultisig-sdk/commit/69bb8307de72883f0c7693871a6ca040b7a0756c)]:
  - @vultisig/sdk@2.8.4

## 0.2.16

### Patch Changes

- [#850](https://github.com/vultisig/vultisig-sdk/pull/850) [`7af5ab2`](https://github.com/vultisig/vultisig-sdk/commit/7af5ab236f3bdd0ba3b78198940044adcd157507) Thanks [@neavra](https://github.com/neavra)! - Honor `VULTISIG_CONFIG_DIR` in the shared `config-store` (vault registry). Previously the
  registry path (`config.json`) was hardcoded to `~/.vultisig` at module load and ignored the
  env var, while `credential-store` honored it — so in Docker/CI with a custom config dir the
  credentials and the vault registry diverged and a loaded wallet became invisible. The config
  dir is now resolved at call time, matching `credential-store`, so both co-locate.

  Also exports `getCredentialsPath` from `credential-store` so consumers (and tests) can
  assert the registry and credentials resolve to the same directory.

- Updated dependencies [[`dc43ea2`](https://github.com/vultisig/vultisig-sdk/commit/dc43ea2657915012032bf273c73ede44a183185b), [`d4ba485`](https://github.com/vultisig/vultisig-sdk/commit/d4ba4854a358235a243d8f8bb2aed0680bbdbaea), [`da59b7f`](https://github.com/vultisig/vultisig-sdk/commit/da59b7f8d7fdf48e26ab4a8617e5273d807b4e66), [`4e733c4`](https://github.com/vultisig/vultisig-sdk/commit/4e733c44708e7b81efd0a9b29298c6a9deba5f51), [`4541e6f`](https://github.com/vultisig/vultisig-sdk/commit/4541e6f9899a5c091b73830db1a2db7e739828de), [`b5ca32d`](https://github.com/vultisig/vultisig-sdk/commit/b5ca32d5e53b85f07531c9303e4c33e2dd44de5d), [`d1b19ed`](https://github.com/vultisig/vultisig-sdk/commit/d1b19ed39102b32f9eb5a51ef794226adb959022), [`59e66c8`](https://github.com/vultisig/vultisig-sdk/commit/59e66c89858f90222a1d2d74eff9e71b69dd2f03), [`4f17411`](https://github.com/vultisig/vultisig-sdk/commit/4f17411ea8d739db706631cf873c85df4d329a0f), [`acfd6e4`](https://github.com/vultisig/vultisig-sdk/commit/acfd6e460e4ea27c7a7bcd668371ab1dea32c345), [`356e841`](https://github.com/vultisig/vultisig-sdk/commit/356e841c35cf38c2671309ae12720666f32745df), [`a22ef41`](https://github.com/vultisig/vultisig-sdk/commit/a22ef4106763fd25992c7f93f72c214dfdcc55d4), [`c778b4c`](https://github.com/vultisig/vultisig-sdk/commit/c778b4cc91a42f4a4488a51ea72a775ad4e78a54), [`f0a5529`](https://github.com/vultisig/vultisig-sdk/commit/f0a5529a8d3cfcce5a2883b5da83e6d15ac270ec), [`3bbe0fb`](https://github.com/vultisig/vultisig-sdk/commit/3bbe0fb011ec2f5502f321255f0304f06ea3e079), [`dac32f6`](https://github.com/vultisig/vultisig-sdk/commit/dac32f61fc5140b4c612801fc45ba48670dffe19), [`ed75992`](https://github.com/vultisig/vultisig-sdk/commit/ed759929cd8612a6873f892d33da2857f18ad9f8), [`f4ba189`](https://github.com/vultisig/vultisig-sdk/commit/f4ba18958d351be48ed83c502895be251bacc47a), [`8ed4b59`](https://github.com/vultisig/vultisig-sdk/commit/8ed4b59680e1285cc374fefba8cf1bd98347ef5e), [`5be6408`](https://github.com/vultisig/vultisig-sdk/commit/5be6408aa51e8c20568ff18c4cf604977c3004ec), [`da4b301`](https://github.com/vultisig/vultisig-sdk/commit/da4b30119916a2a13d0e4e4f4472e4f28ed810c3), [`7d79b2d`](https://github.com/vultisig/vultisig-sdk/commit/7d79b2d1307873937957b9c8caf1886f01d70190), [`31eae40`](https://github.com/vultisig/vultisig-sdk/commit/31eae40e82516e192f11c80516b0da784aafe67b), [`60edbf4`](https://github.com/vultisig/vultisig-sdk/commit/60edbf43c4f8ab9928781adbd4e5d0f0fba6074c), [`0e2e2ab`](https://github.com/vultisig/vultisig-sdk/commit/0e2e2abb3bf312df92131fb997dbaa0802f19c79), [`b9a8cc1`](https://github.com/vultisig/vultisig-sdk/commit/b9a8cc19738333bb42f5d20c6bf849692fec4801), [`f47f060`](https://github.com/vultisig/vultisig-sdk/commit/f47f0606223a0a1905ebb7745d311384488d4178)]:
  - @vultisig/sdk@2.7.0

## 0.2.15

### Patch Changes

- Updated dependencies [[`dc75595`](https://github.com/vultisig/vultisig-sdk/commit/dc75595e83360f5bda84b2d91cae177bc7c8c966)]:
  - @vultisig/sdk@2.0.0

## 0.2.14

### Patch Changes

- [#683](https://github.com/vultisig/vultisig-sdk/pull/683) [`4561129`](https://github.com/vultisig/vultisig-sdk/commit/45611297a55da72d3c56b1a2ffe6522da1b64d7b) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Update SDK package dependencies and Yarn tooling.

- Updated dependencies [[`4561129`](https://github.com/vultisig/vultisig-sdk/commit/45611297a55da72d3c56b1a2ffe6522da1b64d7b)]:
  - @vultisig/sdk@1.8.10

## 0.2.13

### Patch Changes

- Updated dependencies [[`fa95600`](https://github.com/vultisig/vultisig-sdk/commit/fa95600887cb8ca603e8ddcb9c8558eff2d0ea6b)]:
  - @vultisig/sdk@1.0.0

## 0.2.12

### Patch Changes

- Updated dependencies [[`cb21dcf`](https://github.com/vultisig/vultisig-sdk/commit/cb21dcf127e8e08ceaca76439fa28d557cf0fed9)]:
  - @vultisig/sdk@0.28.0

## 0.2.11

### Patch Changes

- Updated dependencies [[`9a80907`](https://github.com/vultisig/vultisig-sdk/commit/9a8090721008f2a10dffa9cf2d3fac479d65481c)]:
  - @vultisig/sdk@0.27.0

## 0.2.10

### Patch Changes

- Updated dependencies [[`cb80440`](https://github.com/vultisig/vultisig-sdk/commit/cb804408b9607aacb143a7a941f0f9f1986f2379)]:
  - @vultisig/sdk@0.26.0

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
