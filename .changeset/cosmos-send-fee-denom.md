---
"@vultisig/sdk": patch
---

feat(cosmos): add optional `feeDenom` to `BuildCosmosSendOptions`

Allows callers to specify a separate gas-fee coin denom when it differs from the send amount denom. Previously `buildCosmosSendTx` always used `denom` (the send coin) as the fee coin — on TerraClassic this meant USTC sends charged fees in USTC instead of LUNC, causing on-chain rejection when the USTC balance was below the fee threshold. Closes vultisig-sdk#624.
