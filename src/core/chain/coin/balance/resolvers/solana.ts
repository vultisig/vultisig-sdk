import { getSolanaClient } from '../../../chains/solana/client'
import { getSplAccounts } from '../../../chains/solana/spl/getSplAccounts'
import { isFeeCoin } from '../../utils/isFeeCoin'
import { PublicKey } from '@solana/web3.js'

import { CoinBalanceResolver } from '../resolver'

export const getSolanaCoinBalance: CoinBalanceResolver = async input => {
  const client = await getSolanaClient()

  if (isFeeCoin(input)) {
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
