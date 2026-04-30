---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': patch
---

feat(chain): THORChain rapid quote with streaming fallback above 3% fee bps

THORChain swap quotes now request rapid (`streaming_interval=0`) first. When `fees.total_bps` exceeds 300, a second streaming quote is fetched (`interval=1`, optional `streaming_quantity` from `max_streaming_quantity`); the better `expected_amount_out` wins, with silent fallback to rapid on errors. `THORCHAIN_STREAMING_SLIPPAGE_THRESHOLD_BPS` disables the extra fetch when set to `Number.MAX_SAFE_INTEGER`. Keysign payload reads THOR streaming fields from the quote memo so they match the selected route.
