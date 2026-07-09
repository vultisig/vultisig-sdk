---
'@vultisig/sdk': patch
---

fix(swap): keep erc20 approve for cowswap orders until permit path is wired (agg-03)

The EIP-2612 permit path (buildEip2612Permit) has zero callers and no permit digest
flows to the MPC keysign payload. Skipping the approve without a wired permit leaves
cowswap permit-token orders with neither approve nor permit, causing silent swap
failures. Keep the normal approve path until the permit flow is complete.
