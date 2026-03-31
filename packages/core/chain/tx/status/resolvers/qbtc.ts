import { StargateClient } from '@cosmjs/stargate'
import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcTendermintRpcUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { decodeTxRaw } from '@cosmjs/proto-signing'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TxStatusResolver } from '../resolver'

export const getQbtcTxStatus: TxStatusResolver<typeof Chain.QBTC> = async ({
  hash,
}) => {
  const client = await StargateClient.connect(qbtcTendermintRpcUrl)

  const { data: tx, error } = await attempt(client.getTx(hash))

  if (error || !tx) {
    return { status: 'pending' }
  }

  const status = tx.code === 0 ? 'success' : 'error'
  const feeCoin = chainFeeCoin[Chain.QBTC]

  const receipt = (() => {
    const gasUsed = tx.gasUsed
    const gasWanted = tx.gasWanted
    if (gasUsed == null || gasWanted == null || gasWanted === 0n) {
      return undefined
    }
    const { data: decoded } = attempt(() => decodeTxRaw(tx.tx))
    if (!decoded) {
      return undefined
    }
    const fee = decoded.authInfo?.fee
    const maxFeeAmount =
      fee?.amount?.[0]?.amount != null ? BigInt(fee.amount[0].amount) : 0n
    const actualFee =
      maxFeeAmount > 0n ? (maxFeeAmount * gasUsed) / gasWanted : 0n
    if (actualFee === 0n) {
      return undefined
    }
    return {
      feeAmount: actualFee,
      feeDecimals: feeCoin.decimals,
      feeTicker: feeCoin.ticker,
    }
  })()

  return { status, receipt }
}
