import { create } from '@bufbuild/protobuf'
import { PublicKey } from '@solana/web3.js'
import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { getDynamicPriorityFeePrice } from '@vultisig/core-chain/chains/solana/getDynamicPriorityFeePrice'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { getSplAssociatedAccount } from '@vultisig/core-chain/chains/solana/spl/getSplAssociatedAccount'
import { SolanaSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { attempt, withFallback } from '@vultisig/lib-utils/attempt'

import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'

export const getSolanaChainSpecific: GetChainSpecificResolver<'solanaSpecific'> = async ({ keysignPayload }) => {
  const coin = getKeysignCoin<OtherChain.Solana>(keysignPayload)
  // DApp signing flows (raw transaction bytes — Jupiter swaps, multi-step
  // routes, etc.) can arrive with an empty `toAddress` because the recipient
  // set isn't a single account. The bytes already carry their own recipients
  // and blockhash; we just need to populate the schema and pick a priority
  // fee. Treat empty as "no specific recipient" instead of throwing.
  const receiver = keysignPayload.toAddress || undefined
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
  //
  // For native SOL the recipient lamports change, so it's writable.
  // For SPL the SystemProgram never touches the recipient's main
  // wallet — only the sender/recipient ATAs are writable.
  // When `receiver` is unknown (DApp signing), fall back to the global feed.
  const writableAccounts: PublicKey[] = []

  if (coin.id) {
    const fromAccount = await getSplAssociatedAccount({
      account: coin.address,
      token: coin.id,
    })
    chainSpecific.fromTokenAssociatedAddress = fromAccount.address
    chainSpecific.programId = fromAccount.isToken2022
    writableAccounts.push(new PublicKey(fromAccount.address))

    if (receiver) {
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
  } else if (receiver) {
    writableAccounts.push(new PublicKey(receiver))
  }

  const priorityFeePrice = await withFallback(
    attempt(getDynamicPriorityFeePrice(writableAccounts)),
    solanaConfig.priorityFeePrice
  )

  chainSpecific.priorityFee = priorityFeePrice.toString()

  return chainSpecific
}
