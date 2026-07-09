import { Chain, UtxoBasedChain } from '../../Chain'

export const minUtxo: Record<UtxoBasedChain, bigint> = {
  [Chain.Cardano]: 1_400_000n,
  [Chain.Bitcoin]: 546n,
  [Chain.Dogecoin]: 1_000_000n,
  // UTXO-02 (audit r2): Litecoin's DUST_RELAY_TX_FEE is ~10x Bitcoin's, so its real standard dust threshold
  // is ~2_940 litoshi for a P2WPKH output (the scriptType LTC uses), ~5_460 legacy P2PKH — NOT 1_000. At the
  // old 1_000n, a change output of 1_001..2_939 litoshi was treated as spendable but is non-standard dust, so
  // the tx could be rejected by relays / get stuck. Use the P2WPKH standard (2_940). KEEP IN SYNC with the
  // per-chain dustLimit map in packages/sdk/src/chains/utxo/tx.ts (UTXO_SPECS). BCH/Dash/Zcash stay at 1_000n
  // — that's already at/above their real ~546 dust (BTC-like relay fee), so it's conservative, not dangerous.
  [Chain.Litecoin]: 2_940n,
  [Chain.BitcoinCash]: 1_000n,
  [Chain.Dash]: 1_000n,
  [Chain.Zcash]: 1_000n,
}
