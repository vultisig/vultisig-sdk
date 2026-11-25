import { UtxoChain } from '@vultisig/core-chain/Chain'
import { getUtxoStats } from '@vultisig/core-chain/chains/utxo/client/getUtxoStats'

const byteFeeMultiplier = (value: bigint) => (value * 25n) / 10n

export const getUtxoByteFee = async (chain: UtxoChain) => {
  // Zcash fees are ZIP-317 conventional fees (1,000 zats per logical action
  // since ZIP 2009) — see ./zip317. The keysign signing-input planner ignores
  // this byteFee for Zcash and prices the plan from ./zip317 directly; 100
  // sat/byte is only the value carried in the payload (Blockchair reports
  // ~1 sat/byte, which no longer means anything for Zcash).
  if (chain === UtxoChain.Zcash) return 100n

  const {
    data: { suggested_transaction_fee_per_byte_sat },
  } = await getUtxoStats(chain)

  const base = BigInt(suggested_transaction_fee_per_byte_sat)

  if (chain === UtxoChain.Dogecoin) {
    // Blockchair reports an inflated DOGE rate; 25% matches the iOS and Android
    // Dogecoin fee multiplier while keeping the value in WalletCore's range.
    return base / 4n
  }

  return byteFeeMultiplier(BigInt(suggested_transaction_fee_per_byte_sat))
}
