---
"@vultisig/sdk": minor
"@vultisig/core-mpc": minor
---

Add a `SignSui` variant to `KeysignPayload.signData` so pre-built Sui Programmable Transaction Blocks (Sui Wallet Standard dApp signing) flow through the standard keysign pipeline instead of a custom-message path. `getSuiSigningInputs` forwards the BCS bytes verbatim via `signDirectMessage`, and `getSuiChainSpecific` returns an empty `SuiSpecific` for this variant (the coins, gas budget and reference gas price are already baked into the bytes, so no RPC lookup is needed).
