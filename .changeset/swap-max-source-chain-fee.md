---
"@vultisig/sdk": patch
---

Max swaps on THORChain and Maya routes now reserve the estimated source-chain network fee instead of subtracting the destination-asset outbound fee, report that fee as the quote's network fee, warn when an amount is below the provider's recommended minimum, and refuse a max swap that would fall below it.
