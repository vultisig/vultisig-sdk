import { decodeTxRaw } from '@cosmjs/proto-signing'
import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { computeCosmosTxReceiptFeeAmount } from '@vultisig/core-chain/chains/cosmos/computeCosmosTxReceiptFeeAmount'
import { sumFeeAmountForCosmosChainFeeDenom } from '@vultisig/core-chain/chains/cosmos/sumFeeAmountForCosmosChainFeeDenom'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TxStatusResolver } from '../resolver'

export const getCosmosTxStatus: TxStatusResolver<CosmosChain> = async ({ chain, hash }) => {
  const { data: client, error: clientError } = await attempt(getCosmosClient(chain))

  if (clientError || !client) {
    return { status: 'pending', isKnown: false }
  }

  const { data: tx, error } = await attempt(client.getTx(hash))

  if (error || !tx) {
    return { status: 'pending', isKnown: false }
  }

  const status = tx.code === 0 ? 'success' : 'error'

  const receipt = (() => {
    const gasUsed = tx.gasUsed
    if (gasUsed == null || gasUsed === 0n) {
      return undefined
    }

    const decodeResult = attempt(() => decodeTxRaw(tx.tx))
    if ('error' in decodeResult || !decodeResult.data) {
      return undefined
    }

    const decoded = decodeResult.data
    const fee = decoded.authInfo?.fee
    const maxFeeAmount = sumFeeAmountForCosmosChainFeeDenom({
      amounts: fee?.amount,
      chain,
    })

    if (maxFeeAmount === null || maxFeeAmount === 0n) {
      return undefined
    }

    const actualFee = computeCosmosTxReceiptFeeAmount({
      gasUsed,
      gasWantedFromTx: tx.gasWanted ?? 0n,
      feeGasLimit: fee?.gasLimit ?? 0n,
      maxFeeAmount,
    })

    if (actualFee === undefined) {
      return undefined
    }

    const feeCoin = chainFeeCoin[chain]
    return {
      feeAmount: actualFee,
      feeDecimals: feeCoin.decimals,
      feeTicker: feeCoin.ticker,
    }
  })()

  return { status, receipt }
}
