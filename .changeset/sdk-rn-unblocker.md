---
"@vultisig/sdk": patch
---

Add a React Native platform entry for @vultisig/sdk — Hermes-safe tx builders + RPC helpers for 9 chains (EVM, Solana, Cosmos, Sui, TON, Tron, Ripple, UTXO, Cardano), `fastVaultSign` + relay orchestrators, and `configureRuntime` for consumer-injected endpoints. No breaking change for browser / node / electron / chrome-extension / vite consumers — all core chain/swap/balance helpers keep their original sync signatures; RN-only lazy loading is isolated in `packages/sdk/src/platforms/react-native/overrides/` and applied via rollup path-based intercept on the RN build target only.

**Signature-meaningful fund-safety fixes (applied in R2 review round):**

- `buildUtxoSendTx().finalize()` now returns a BIP141-compliant **txid** (computed from the witness-stripped base tx) for P2WPKH chains. Previously returned the wtxid, which is unusable for block-explorer / mempool lookups. Callers that persisted the old `txHashHex` for segwit chains (BTC, LTC) were recording the wrong hash.
- `fastVaultSign` now throws if the MPC engine returns an ECDSA signature without a `recovery_id` (previously silently wrote `v=0`, producing a tx that recovers the wrong EVM signer).
- `configureRuntime` now validates `vultiServerUrl` / `relayUrl` as http(s) URLs (previously accepted any string including `''`, silently exposing vault passwords to misconfigured endpoints).
- `ReactNativeStorage.clear()` now calls `AsyncStorage.multiRemove` (was `removeMany`, which does not exist on `^2.x` — the shipped-consumer version — and threw at runtime on every `clear()` call).
- BCH CashAddr decoder now verifies the polymod checksum before stripping it (previously accepted any typo'd address with valid base32 chars, producing a garbage pubKeyHash and signing the tx to an unrelated address).
- Ripple `account_info` for unfunded accounts now returns `funded: false` instead of throwing on XRPL's `actNotFound` response.
- Zcash sighash `branchId` is now a per-call parameter (defaulting to NU6.1) so future consensus upgrades don't require a shipped SDK release.
