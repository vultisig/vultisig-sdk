# @vultisig/rujira

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
