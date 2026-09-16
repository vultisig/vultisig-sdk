---
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

`buildSendKeysignPayload` now refuses known burn / program destinations (`assertSafeDestination`) on every chain, so a wallet send to the Solana System Program, the EVM zero address, a Bitcoin eater address or an XRPL black-hole account is rejected before the ceremony — the same guard the SDK's vault-free agent prep helpers already applied. The rejection surfaces as `BuildKeysignPayloadError('dangerous-destination')`; fee estimation through `getSendFeeEstimate` rejects the same destinations.
