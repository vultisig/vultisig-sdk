---
'@vultisig/sdk': minor
---

Add `evm.getTokenApprovals(chain, { owner })`: read-only enumeration of active
ERC-20 approvals (spender allowances) for an address on any supported EVM chain.
Scans `Approval(owner, spender, value)` logs (full-history "earliest" with a
bounded recent-window fallback when an RPC rejects the unbounded range),
de-dupes `(token, spender)` pairs, re-reads the CURRENT `allowance()` per pair so
revoked/spent approvals drop out, resolves `symbol()` fail-soft, and flags
`isUnlimited` for allowances >= 2^128. No signing, no broadcast. Ported from the
mcp-ts `get_token_approvals` tool.
