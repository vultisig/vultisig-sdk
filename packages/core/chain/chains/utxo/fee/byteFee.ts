import { UtxoChain } from '@vultisig/core-chain/Chain'
import { getUtxoStats } from '@vultisig/core-chain/chains/utxo/client/getUtxoStats'
import { rootApiUrl } from '@vultisig/core-config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { bigIntMax } from '@vultisig/lib-utils/bigint/bigIntMax'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { ceilDiv } from './zip317'

const byteFeeMultiplier = (value: bigint) => (value * 25n) / 10n

const mempoolBlocksUrl = `${rootApiUrl}/mempool/v1/fees/mempool-blocks`
const mempoolBlocksTimeoutMs = 5_000
const maxNextBlockMedianFee = 5_000
const bitcoinMinByteFee = 2n

const parseNextBlockMedianFee = (blocks: unknown): number | undefined => {
  if (!Array.isArray(blocks)) return undefined

  const [nextBlock] = blocks
  if (typeof nextBlock !== 'object' || nextBlock === null || !('medianFee' in nextBlock)) return undefined

  const { medianFee } = nextBlock
  if (typeof medianFee !== 'number') return undefined

  return medianFee > 0 && medianFee <= maxNextBlockMedianFee ? medianFee : undefined
}

const getBitcoinNextBlockMedianFee = async (): Promise<number | undefined> => {
  // Own controller so the deadline also covers the body read.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), mempoolBlocksTimeoutMs)

  try {
    const result = await attempt(queryUrl<unknown>(mempoolBlocksUrl, { signal: controller.signal }))

    return 'error' in result ? undefined : parseNextBlockMedianFee(result.data)
  } finally {
    clearTimeout(timeoutId)
  }
}

const getBitcoinByteFee = async (blockchairByteFee: bigint): Promise<bigint> => {
  const nextBlockMedianFee = await getBitcoinNextBlockMedianFee()

  // No usable next-block data: keep today's Blockchair x2.5.
  if (nextBlockMedianFee === undefined) return byteFeeMultiplier(blockchairByteFee)

  // In millisats per vbyte so every platform rounds identically.
  const milliByteFee = bigIntMax(BigInt(Math.ceil(nextBlockMedianFee * 1000)), blockchairByteFee * 1000n)
  const byteFee = ceilDiv({ value: milliByteFee * 125n, divisor: 100_000n })

  // Without RBF a stuck send cannot be bumped, so never sign below 2 sat/vB.
  return bigIntMax(bitcoinMinByteFee, byteFee)
}

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
    // Blockchair reports an inflated DOGE rate; 25% matches the iOS and Android
    // Dogecoin fee multiplier while keeping the value in WalletCore's range.
    return base / 4n
  }

  if (chain === UtxoChain.Bitcoin) return getBitcoinByteFee(base)

  return byteFeeMultiplier(base)
}
