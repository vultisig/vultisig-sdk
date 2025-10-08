import { create } from '@bufbuild/protobuf'

import { shouldBePresent } from '../../../../../lib/utils/assert/shouldBePresent'
import { attempt } from '../../../../../lib/utils/attempt'
import { getSolanaClient } from '../../../../chain/chains/solana/client'
import { solanaConfig } from '../../../../chain/chains/solana/solanaConfig'
import { getSplAssociatedAccount } from '../../../../chain/chains/solana/spl/getSplAssociatedAccount'
import { isFeeCoin } from '../../../../chain/coin/utils/isFeeCoin'
import {
  SolanaSpecific,
  SolanaSpecificSchema,
} from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'
// import { PublicKey } from '@solana/web3.js' // Using dynamic import instead
import { ChainSpecificResolver } from '../resolver'

export const getSolanaSpecific: ChainSpecificResolver<SolanaSpecific> = async ({
  coin,
  receiver,
}) => {
  const client = await getSolanaClient()

  const recentBlockHash = (
    await client.getLatestBlockhash()
  ).blockhash.toString()

  const { PublicKey } = await import('@solana/web3.js')
  const prioritizationFees = await client.getRecentPrioritizationFees({
    lockedWritableAccounts: [new PublicKey(coin.address)],
  })

  // regardless of its complexity Solana charges a fixed base transaction fee of 5000 lamports per transaction.
  const highPriorityFee =
    Math.max(
      ...prioritizationFees.map(fee => Number(fee.prioritizationFee.valueOf())),
      solanaConfig.priorityFeeLimit
    ) + solanaConfig.baseFee

  const result = create(SolanaSpecificSchema, {
    recentBlockHash,
    priorityFee: highPriorityFee.toString(),
  })

  if (!isFeeCoin(coin)) {
    const fromAccount = await getSplAssociatedAccount({
      account: coin.address,
      token: shouldBePresent(coin.id),
    })
    result.fromTokenAssociatedAddress = fromAccount.address.toString()
    const toAccount = await attempt(
      getSplAssociatedAccount({
        account: shouldBePresent(receiver),
        token: shouldBePresent(coin.id),
      })
    )
    if ('data' in toAccount) {
      result.toTokenAssociatedAddress = toAccount.data.address.toString()
      result.programId = toAccount.data.isToken2022
    }
  }

  return result
}
