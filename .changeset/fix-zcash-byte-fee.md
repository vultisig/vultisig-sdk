---
"@vultisig/sdk": patch
---

Remove hardcoded 1000 sat/byte Zcash fee override — use the standard UTXO fee rate lookup instead, which returns a reasonable fee that satisfies ZIP-317
