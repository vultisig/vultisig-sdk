---
'@vultisig/sdk': patch
---

fix(prep): enforce native-quote expiry + committed-amount consistency in the vault-free swap builder (ABTS/plan 005)

`prepareSwapTxFromKeys` (the vault-free, agent/MCP-reachable swap payload builder) previously enforced neither quote expiry nor amount↔quote consistency, unlike the vault-wrapped `SwapService.prepareSwapTx`. It now, before any signable side effects:

- rejects an expired native (THORChain/Maya) quote via the authoritative `quote.native.expiry`, mirroring core's `assertQuoteNotExpired`;
- rejects an expired CoW order via the authoritative `cowswap_order.validTo`;
- cross-checks the caller's `amount` against the CoW order's committed gross sell amount (`sellAmount + feeAmount`) to catch a stale/mismatched quote. The `transfer` route is intentionally excluded because its amount is provider-committed and legitimately diverges from the caller input by small fee adjustments; `evm`/`solana`/native fail open (no confidently-comparable committed field).
