---
'@vultisig/sdk': patch
---

fix(cosmos): apply IBC gas multiplier to MsgTransfer (COSMOS-02)

The Cosmos signing-inputs and fee-display resolvers used the flat per-chain gas limit (calibrated for `bank.MsgSend`) for every IBC message, including a full ICS-20 `MsgTransfer` with an optional PFM (packet-forward-middleware) memo. IBC transfers do measurably more work on the source leg — channel-state writes plus a relayer event — so the flat limit can run out of gas mid-execution: the fee is spent, the transfer fails, and funds don't move but the fee is still burned. `resolveCosmosGasFee` now applies the same `IBC_GAS_MULTIPLIER` (×2) the app's own Cosmos tx builder already documents (`vultiagent-app/src/services/cosmosTx.ts`), scoped to `IBC_TRANSFER` messages only — plain sends and wasm executes on ibc-enabled chains keep paying the calibrated flat fee.
