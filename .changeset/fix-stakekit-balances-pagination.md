---
'@vultisig/sdk': patch
---

Fix `sdk.defi.stakekit.balances()` silently truncating position discovery at the first 100 integrations. `getBalances` only fetched page 1 of `/yields/enabled` when discovering which integrations to check for a wallet's positions, ignoring the response's `hasNextPage` flag. On a dense network with more than one page of integrations, any integration past the first page was never queried, and a real position there read back as "no balance" rather than an error. `getBalances` now follows `hasNextPage` across pages (bounded to 50 pages as a safety cap) to build the complete integration set before querying balances.
