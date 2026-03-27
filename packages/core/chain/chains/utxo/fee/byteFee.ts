import { UtxoChain } from '@vultisig/core-chain/Chain'
import { getUtxoStats } from '@vultisig/core-chain/chains/utxo/client/getUtxoStats'

const byteFeeMultiplier = (value: bigint) => (value * 25n) / 10n

export const getUtxoByteFee = async (chain: UtxoChain) => {
  // ZIP-317 requires a minimum fee of 10,000 zatoshis per ZEC transaction.
  // Blockchair returns ~1 sat/byte which is too low. 100 sat/byte ensures
  // typical transactions (150-250 bytes) always meet the 10,000 minimum.
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
