import { create } from '@bufbuild/protobuf'
import { PublicKey } from '@solana/web3.js'
import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { getDynamicPriorityFeePrice } from '@vultisig/core-chain/chains/solana/getDynamicPriorityFeePrice'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { getSplAssociatedAccount } from '@vultisig/core-chain/chains/solana/spl/getSplAssociatedAccount'
import { SolanaSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { attempt, withFallback } from '@vultisig/lib-utils/attempt'

import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'
import { refineSolanaChainSpecific } from './refine'

export const getSolanaChainSpecific: GetChainSpecificResolver<
  'solanaSpecific'
> = async ({ keysignPayload, walletCore }) => {
  const coin = getKeysignCoin<OtherChain.Solana>(keysignPayload)
  const receiver = shouldBePresent(keysignPayload.toAddress)
  const client = getSolanaClient()

  const recentBlockHash = (await client.getLatestBlockhash()).blockhash

  const chainSpecific = create(SolanaSpecificSchema, {
    recentBlockHash,
    computeLimit: solanaConfig.priorityFeeLimit.toString(),
  })

  // Scope the priority-fee query to slots that wrote to the contended
  // accounts on this transaction. The global feed is dominated by vote
  // txs and underestimates fees for hot accounts (e.g. a THORChain
  // inbound vault during LP add).
  const writableAccounts: PublicKey[] = [new PublicKey(receiver)]

  if (coin.id) {
    const fromAccount = await getSplAssociatedAccount({
      account: coin.address,
      token: coin.id,
    })
    chainSpecific.fromTokenAssociatedAddress = fromAccount.address
    chainSpecific.programId = fromAccount.isToken2022
    writableAccounts.push(new PublicKey(fromAccount.address))

    const { data } = await attempt(
      getSplAssociatedAccount({
        account: receiver,
        token: coin.id,
      })
    )
    if (data) {
      chainSpecific.toTokenAssociatedAddress = data.address
      writableAccounts.push(new PublicKey(data.address))
    }
  }

  const priorityFeePrice = await withFallback(
    attempt(getDynamicPriorityFeePrice(writableAccounts)),
    solanaConfig.priorityFeePrice
  )

  chainSpecific.priorityFee = priorityFeePrice.toString()

  return withFallback(
    attempt(
      refineSolanaChainSpecific({
        keysignPayload,
        chainSpecific,
        priorityFeePrice,
        walletCore,
      })
    ),
    chainSpecific
  )
}
