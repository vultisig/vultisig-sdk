---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Reject testnet-only TON friendly destinations before mainnet address normalization, native and Jetton signing-input construction, gasless serialization, and public transaction preparation. Preserve supported mainnet friendly encodings and raw-address signing behavior.
