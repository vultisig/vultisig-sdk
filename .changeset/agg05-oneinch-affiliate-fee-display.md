---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(swap): populate 1inch affiliateFee for display (AGG-05) — 1inch general-swap quotes never populated `affiliateFee` on the returned `GeneralSwapQuote`, unlike Kyber and LI.FI, leaving the fee-transparency row blank for 1inch even though a real affiliate cut is taken via its `fee`/`referrer` params. `getOneInchSwapQuote` now grosses the post-fee `dstAmount` back up (same bps-based calc `getKyberSwapAffiliateFee` uses) to compute and attach a display-only `affiliateFee`.
