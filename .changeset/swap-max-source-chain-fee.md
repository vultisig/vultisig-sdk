---
"@vultisig/sdk": patch
"@vultisig/cli": patch
"@vultisig/core-chain": patch
---

Max swaps on THORChain and Maya routes now reserve the estimated source-chain network fee instead of subtracting the destination-asset outbound fee, pin fee-aware requotes to the selected provider, clamp once when memo-dependent fees drift, expose the committed amount to callers, report the source-chain fee as the quote's network fee, and refuse a max swap that would fall below it.
