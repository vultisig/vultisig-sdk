---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

fix(swap): expose inner-executor approvalAddress on EVM swap routes (LiFi + SwapKit)

EVM aggregator routes (LI.FI, SwapKit) can delegate the ERC-20 `transferFrom` to an
inner executor contract that is distinct from the outer `tx.to` router. Approving only
`tx.to` leads to an "ERC20: transfer amount exceeds allowance" revert on-chain.

This fix threads the route's real spender address through as `evm.approvalAddress` on
`GeneralSwapTx`. Consumers building an ERC-20 approve leg MUST use this field as the
spender when present, falling back to `to` only when absent.
