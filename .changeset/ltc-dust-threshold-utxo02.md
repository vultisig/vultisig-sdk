---
'@vultisig/sdk': patch
---

fix(utxo): raise the Litecoin dust threshold to the real P2WPKH standard (~2_940 litoshi)

Litecoin's DUST_RELAY_TX_FEE is ~10x Bitcoin's, so LTC's real standard dust threshold is ~2_940 litoshi for a P2WPKH output, not the hardcoded 1_000n. At 1_000n a change output of 1_001..2_939 litoshi was treated as spendable but is non-standard dust, so the transaction could be rejected by relays or stall. Bumped in both dust maps (core `minUtxo` + sdk `UTXO_SPECS`) and kept in sync. LTC-scoped (UTXO-02); BCH/Dash/Zcash 1_000n already sits at/above their real dust.
