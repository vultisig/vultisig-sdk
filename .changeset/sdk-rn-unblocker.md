---
"@vultisig/sdk": patch
---

Add a React Native platform entry for @vultisig/sdk — Hermes-safe tx builders + RPC helpers for 9 chains (EVM, Solana, Cosmos, Sui, TON, Tron, Ripple, UTXO, Cardano), `fastVaultSign` + relay orchestrators, and `configureRuntime` for consumer-injected endpoints. No breaking change for browser / node / electron / chrome-extension / vite consumers — all core chain/swap/balance helpers keep their original sync signatures; RN-only lazy loading is isolated in `packages/sdk/src/platforms/react-native/overrides/` and applied via rollup path-based intercept on the RN build target only.
