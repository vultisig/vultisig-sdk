---
"@vultisig/core-chain": minor
---

feat(chain): Uniswap Universal Router command decoder

Decodes `execute(bytes commands, bytes[] inputs, uint256 deadline)` calldata into an aggregate swap intent (from token, to token, amount in, amount out min). Exposed at `@vultisig/core-chain/chains/evm/contract/universalRouter/{decode,opcodes,types}`.

Covers V2 / V3 / V4 swaps (exact-in and exact-out), WRAP_ETH and UNWRAP_WETH framing, split-route aggregation across identical pairs, and the CONTRACT_BALANCE sentinel. Unknown opcodes (Permit2, sweep, transfer) are skipped rather than rejected so the router's usual bundling doesn't drop the whole decode.

Returns `null` for non-Universal-Router calldata. Native ETH is represented by the zero address — callers should translate to the chain's fee coin when displaying.
