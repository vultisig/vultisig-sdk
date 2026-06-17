---
"@vultisig/core-mpc": minor
"@vultisig/sdk": minor
---

feat(swap): support an explicit gas limit override for EVM swaps

`buildSwapKeysignPayload` now accepts an optional `gasLimitOverride` (units).
When set on an EVM swap it replaces the aggregator's estimated
`ethereumSpecific.gasLimit` (and the mirrored 1inch `tx.gas`), while the gas
price is still computed normally. Ignored for non-EVM chains and when omitted —
no behavior change.

Part of wiring the Advanced Swap settings (vultisig/vultisig-windows#4131).
