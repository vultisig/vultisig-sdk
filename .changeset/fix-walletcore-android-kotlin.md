---
"@vultisig/walletcore-native": patch
---

Fix Android Kotlin compilation against TrustWallet JNI bindings

- Import `wallet.core.java.AnySigner` (lives outside `wallet.core.jni.*`)
- Fix `anyAddressIsValidSS58` return type (`Nothing` -> `Boolean`) so Kotlin can reify the type parameter
- Use `AnySigner.nativePlan(byte[], int)` instead of protobuf `plan()` overload that requires 3 params
- Pass required `bounceable` and `testnet` boolean params to `TONAddressConverter.toUserFriendly`
