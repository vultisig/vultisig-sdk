---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

fix(ustc): dynamic burn-tax for TerraClassic USTC sends, case-insensitive coin id check

Replaces the hardcoded 1,000,000 uusd fee surcharge with a live LCD `tax_rate` + optional `tax_cap` query for TerraClassic USTC (uusd) sends.

- `computeUstcBurnTaxAmount()` fetches on-chain rate and cap, returns '0' when rate is zero (current post-UST-collapse governance state)
- Fail-open on LCD outage: falls back to '0' so sends are never blocked when burn tax is zero; ante handler rejects if rate is non-zero and LCD is down
- Case-insensitive `coin.id?.toLowerCase() === 'uusd'` guard to match `areEqualCoins` behavior
- 5 unit tests covering: rate=0, rate=1.2%, rate+cap, LCD outage, LUNC non-USTC exclusion
