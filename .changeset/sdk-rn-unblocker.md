---
'@vultisig/sdk': minor
---

Add a React Native platform entry for @vultisig/sdk — new subpath export `@vultisig/sdk/react-native`, Hermes-safe tx builders + RPC helpers for 9 chains (EVM, Solana, Cosmos, Sui, TON, Tron, Ripple, UTXO, Cardano), `fastVaultSign` + relay orchestrators, and `configureRuntime` for consumer-injected endpoints. No breaking change for browser / node / electron / chrome-extension / vite consumers — all core chain/swap/balance helpers keep their original sync signatures; RN-only lazy loading is isolated in `packages/sdk/src/platforms/react-native/overrides/` and applied via rollup path-based intercept on the RN build target only. Bumped to `minor` per "new public API surface = minor" semver convention so consumers' `^0.x` ranges accept this only after they opt in.

**Signature-meaningful fund-safety fixes (applied in R2 + R4 review rounds):**

- `buildUtxoSendTx().finalize()` now returns a BIP141-compliant **txid** (computed from the witness-stripped base tx) for P2WPKH chains. Previously returned the wtxid, which is unusable for block-explorer / mempool lookups. Callers that persisted the old `txHashHex` for segwit chains (BTC, LTC) were recording the wrong hash.
- `fastVaultSign` now throws if the MPC engine returns an ECDSA signature without a `recovery_id` (previously silently wrote `v=0`, producing a tx that recovers the wrong EVM signer).
- `configureRuntime` now validates `vultiServerUrl` / `relayUrl` as http(s) URLs (previously accepted any string including `''`, silently exposing vault passwords to misconfigured endpoints).
- `ReactNativeStorage.clear()` now calls `AsyncStorage.multiRemove` (was `removeMany`, which does not exist on `^2.x` — the shipped-consumer version — and threw at runtime on every `clear()` call).
- BCH CashAddr decoder now verifies the polymod checksum before stripping it (previously accepted any typo'd address with valid base32 chars, producing a garbage pubKeyHash and signing the tx to an unrelated address).
- Ripple `account_info` for unfunded accounts now returns `funded: false` instead of throwing on XRPL's `actNotFound` response.
- Zcash sighash `branchId` is now a per-call parameter (defaulting to NU6.1) so future consensus upgrades don't require a shipped SDK release.
- XRP `buildXrpSendTx().finalize()` now accepts both 128-char (`r||s`) and 130-char (`r||s||recovery_id`) hex signatures — `fastVaultSign` returns the 130-char shape for ECDSA, so every `build_xrp_send → fastVaultSign → finalize` flow previously threw at submit time.
- UTXO base58 decoder now identifies P2SH addresses by version byte (`0x05` BTC, `0x32` LTC, `0x16` DOGE, `0x10` DASH, Zcash `t3...`) and emits the `OP_HASH160 <hash> OP_EQUAL` locking script; previously every base58 destination was re-encoded as P2PKH, so funds sent to a `3...` exchange deposit were locked under a hash that matched no spendable key.
- Blockchair URL helpers (`getUtxos`, `getUtxoBalance`, `estimateUtxoFee`, `broadcastUtxoTx`) now respect the documented contract that `apiUrl` is already chain-scoped — previously they appended the slug a second time, producing `/blockchair/bitcoin/bitcoin/...` and 404s on every Blockchair-backed UTXO call.
- `configureMpc` duplicate-engine guard now also reads `EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON` as a fallback so Expo / React Native consumers can opt out of the dev throw without a custom Babel transform (Expo only inlines `EXPO_PUBLIC_*` env vars into the JS bundle). `VULTISIG_STRICT_SINGLETON` still wins when both are set.
