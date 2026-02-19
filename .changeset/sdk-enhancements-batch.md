---
'@vultisig/sdk': minor
---

Add vault reshare support, fix secure vault creation progress steps, and add balancesWithPrices method

- Add `performReshare()` to Vultisig class and SecureVaultCreationService for vault reshare operations
- Fix secure vault creation progress mapping so QR code and device discovery UI display correctly during the waiting-for-devices phase
- Add `balancesWithPrices()` to VaultBase that returns balances enriched with price and fiat value data from FiatValueService
