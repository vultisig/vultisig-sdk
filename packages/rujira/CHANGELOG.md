# @vultisig/rujira

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
