import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'

import { token2022ProgramId } from '../config'

type Input = {
  account: string
  token: string
}

export const getSplAssociatedAccount = async ({
  account,
  token,
}: Input): Promise<{ address: string; isToken2022: boolean }> => {
  const [client, { PublicKey }] = await Promise.all([
    getSolanaClient(),
    import('@solana/web3.js'),
  ])

  const response = await client.getParsedTokenAccountsByOwner(
    new PublicKey(account),
    { mint: new PublicKey(token) }
  )

  if (!response.value || response.value.length === 0) {
    throw new Error('No associated token account found')
  }

  const isToken2022 =
    response.value[0].account.owner.toBase58() === token2022ProgramId

  return {
    address: response.value[0].pubkey.toBase58(),
    isToken2022,
  }
}
