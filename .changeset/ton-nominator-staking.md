---
"@vultisig/core-chain": minor
"@vultisig/core-mpc": patch
"@vultisig/sdk": minor
---

Add TON nominator-pool staking support. `@vultisig/core-chain` gains a tonapi staking client (`chains/ton/staking`) — pool list, computed pool info, and account nominator positions — plus per-implementation deposit/withdraw comment resolution (`whales` → `Deposit`/`Withdraw`, `tf` → `d`/`w`), pool eligibility/capacity filters, and a `tonAddressToBounceable` helper that normalizes raw `0:` pool addresses to the bounceable `EQ…` form. `@vultisig/core-mpc` now forces TON transfers bounceable for any staking comment (via `isTonStakingComment`), so a rejected pool deposit/withdraw bounces back instead of being absorbed.
