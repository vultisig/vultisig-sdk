# @vultisig/walletcore-native

## 1.0.0

### Major Changes

- [#2218](https://github.com/vultisig/vultisig-sdk/pull/2218) [`d043dc4`](https://github.com/vultisig/vultisig-sdk/commit/d043dc43d9fe33a3160c2739150fd6294f0e7eff) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Unify the workspace on the coordinated Noble/Scure v2 stack and align related workspace peer dependency ranges.

## 0.2.0

### Minor Changes

- [#1541](https://github.com/vultisig/vultisig-sdk/pull/1541) [`b9f81af`](https://github.com/vultisig/vultisig-sdk/commit/b9f81af9065a5c0bfc2f86f8fb20aa51e670ab77) Thanks [@realpaaao](https://github.com/realpaaao)! - Add Robinhood Chain (Arbitrum Orbit EVM L2, chain id 4663, ETH gas). Swaps enabled via LiFi and KyberSwap.

## 0.1.2

### Patch Changes

- [#272](https://github.com/vultisig/vultisig-sdk/pull/272) [`496fa54`](https://github.com/vultisig/vultisig-sdk/commit/496fa54a7132d14c82933f27b78b428d4c0caf4a) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Fix Android Kotlin compilation against TrustWallet JNI bindings
  - Import `wallet.core.java.AnySigner` (lives outside `wallet.core.jni.*`)
  - Fix `anyAddressIsValidSS58` return type (`Nothing` -> `Boolean`) so Kotlin can reify the type parameter
  - Use `AnySigner.nativePlan(byte[], int)` instead of protobuf `plan()` overload that requires 3 params
  - Pass required `bounceable` and `testnet` boolean params to `TONAddressConverter.toUserFriendly`
