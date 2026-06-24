---
'@vultisig/sdk': minor
---

feat(sdk): add `sdk.evm.encodeErc20Approve` + `encodeErc20Revoke`

Two pure-crypto primitives under the EVM tools module:

- `encodeErc20Approve(spender, amount)` — ABI-encodes `approve(spender, amount)`
  calldata (selector `0x095ea7b3`). No RPC, no `decimals()` lookup; the caller
  passes `amount` already in base units. `MAX_UINT256` is exported for the
  explicit unlimited-approval case — the API never silently defaults to
  unlimited (bounded-by-default). `spender` is normalized to its EIP-55
  checksum.
- `encodeErc20Revoke(spender)` — `approve(spender, 0)`, the standard revoke
  pattern; works on non-standard tokens that don't implement `decimals()`.

Both produce UNSIGNED calldata only, fail closed on a negative / out-of-range
amount or a malformed spender, and are exported from the generic and React
Native entry points.
