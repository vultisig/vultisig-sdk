import { UtxoChain } from '@vultisig/core-chain/Chain'
import { getUtxoStats } from '@vultisig/core-chain/chains/utxo/client/getUtxoStats'

const byteFeeMultiplier = (value: bigint) => (value * 25n) / 10n

export const getUtxoByteFee = async (chain: UtxoChain) => {
  // ZIP-317 requires 5,000 zats per logical action (10,000 zat floor) — see
  // ./zip317 for the conventional-fee formula. Blockchair reports ~1 sat/byte
  // which is below that floor; 100 sat/byte clears it for any realistic tx
  // shape (a P2PKH input pays 14,800 zats vs 5,000 required per action).
  if (chain === UtxoChain.Zcash) return 100n

  const {
    data: { suggested_transaction_fee_per_byte_sat },
  } = await getUtxoStats(chain)

  const base = BigInt(suggested_transaction_fee_per_byte_sat)

  if (chain === UtxoChain.Dogecoin) {
    // According to iOS implementation: For Dogecoin, the API responds with 500,000 sats/byte, which exceeds what WalletCore expects.
    // To ensure compatibility with WalletCore, we divide the API value by 10 to bring it into an acceptable range.
    return base / 10n
  }

  return byteFeeMultiplier(BigInt(suggested_transaction_fee_per_byte_sat))
}
