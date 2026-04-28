# @vultisig/walletcore-native

## 0.1.2

### Patch Changes

- [#272](https://github.com/vultisig/vultisig-sdk/pull/272) [`496fa54`](https://github.com/vultisig/vultisig-sdk/commit/496fa54a7132d14c82933f27b78b428d4c0caf4a) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Fix Android Kotlin compilation against TrustWallet JNI bindings
  - Import `wallet.core.java.AnySigner` (lives outside `wallet.core.jni.*`)
  - Fix `anyAddressIsValidSS58` return type (`Nothing` -> `Boolean`) so Kotlin can reify the type parameter
  - Use `AnySigner.nativePlan(byte[], int)` instead of protobuf `plan()` overload that requires 3 params
  - Pass required `bounceable` and `testnet` boolean params to `TONAddressConverter.toUserFriendly`
