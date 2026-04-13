---
"@vultisig/cli": patch
---

CLI agent executor now surfaces unimplemented and stub actions as failures (`success: false`) instead of returning misleading success. Removed `get_market_price` and `thorchain_query` from the local auto-execute allowlist where there is no implementation.
