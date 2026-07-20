---
'@vultisig/sdk': patch
---

Fix `vault.broadcastRawTx` reporting a false success for a Cosmos transaction that was included but failed execution. `RawBroadcastService.broadcastCosmosRawTx` returned `result.transactionHash` whenever `StargateClient.broadcastTx` didn't throw, but that client resolves (does not throw) once a tx is included even when DeliverTx failed (`code !== 0` — out-of-gas, wasm revert, a THORChain/Maya deposit-handler rejection). The tx is on-chain but nothing moved, so the raw path now asserts DeliverTx success and throws `BroadcastFailed` on execution failure, matching the signing-input broadcast resolver (#1316).
