// RN override for `@vultisig/core-chain/coin/balance/resolvers/solana`.
//
// The core balance resolver statically imports `PublicKey` from
// `@solana/web3.js`. The RN `getCoinBalance` dispatcher lazy-loads this
// module via `import('@vultisig/core-chain/coin/balance/resolvers/solana')`,
// but the *module body* evaluation still triggers the static
// `@solana/web3.js` import — which crashes Hermes before we ever reach
// the function body. Deferring the `@solana/web3.js` import to inside
// the async resolver keeps module-init cheap and only pulls web3.js
// when the resolver actually runs.
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import type { CoinBalanceResolver } from '@vultisig/core-chain/coin/balance/resolver'

import { getSplAccounts } from './getSplAccounts'

export const getSolanaCoinBalance: CoinBalanceResolver = async input => {
  const client = getSolanaClient()

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
