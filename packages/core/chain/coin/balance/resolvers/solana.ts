import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { getSplAccounts } from '@vultisig/core-chain/chains/solana/spl/getSplAccounts'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'

import { CoinBalanceResolver } from '../resolver'

export const getSolanaCoinBalance: CoinBalanceResolver = async input => {
  const client = await getSolanaClient()

  if (isFeeCoin(input)) {
    const { PublicKey } = await import('@solana/web3.js')
    const balance = await client.getBalance(new PublicKey(input.address))

    return BigInt(balance)
  }

  const accounts = await getSplAccounts(input.address)

  const tokenAccount = accounts.find(
    account => account.account.data.parsed.info.mint === input.id
  )

  const tokenAmount =
    tokenAccount?.account?.data?.parsed?.info?.tokenAmount?.amount

  return BigInt(tokenAmount ?? 0)
}
