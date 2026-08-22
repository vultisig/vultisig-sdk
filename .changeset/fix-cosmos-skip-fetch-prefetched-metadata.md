---
'@vultisig/sdk': minor
---

Fix `skipChainSpecificFetch` silently signing Cosmos transactions against account number / sequence `0`. The flag is documented as an offline / pre-fetched signing mode, but the builders had no way to receive the pre-fetched values and defaulted them to `'0'` - producing a signature bound to the wrong account state for any account that has ever transacted. `CosmosSigningOptions` now takes `accountNumber` and `sequence`, and `buildSignAminoKeysignPayload` / `buildSignDirectKeysignPayload` fail closed when the flag is set without them.

**Behaviour change:** a caller that passes `skipChainSpecificFetch: true` without the pre-fetched values now throws instead of emitting a zero-sequence payload. That payload was never broadcastable, so this converts a silent broadcast-time rejection into an actionable build-time error.
