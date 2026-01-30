---
"@vultisig/sdk": minor
---

Add automatic VULT discount tier support for swap affiliate fees

- Add `DiscountTierService` that fetches VULT token and Thorguard NFT balances on Ethereum
- Automatically apply discount tiers (bronze through ultimate) to all swap quotes
- Add `vault.getDiscountTier()` to check current discount tier
- Add `vault.updateDiscountTier()` to force refresh after acquiring more VULT
- Remove manual `affiliateBps` parameter from swap quote params (now automatic)
- Cache discount tier for 15 minutes to minimize RPC calls
