---
"@vultisig/sdk": patch
---

feat(examples): add discount tier display to browser and electron examples

- Add `getDiscountTier()` and `updateDiscountTier()` to ISDKAdapter interface
- Implement discount tier methods in BrowserSDKAdapter and ElectronSDKAdapter
- Add VULT Discount Tier card to VaultOverview with color-coded tier badge and refresh button
- Display discount tier in swap quote details
- Update browser README with discount tier and swap documentation
