import { getSolanaClient } from '../client'
// import { PublicKey } from '@solana/web3.js' // Using dynamic import instead
import { token2022ProgramId } from '../config'

type Input = {
  account: string
  token: string
}

export const getSplAssociatedAccount = async ({
  account,
  token,
}: Input): Promise<{ address: any; isToken2022: boolean }> => {
  const { PublicKey } = await import('@solana/web3.js')
  const client = await getSolanaClient()

  const { value } = await client.getTokenAccountsByOwner(
    new PublicKey(account),
    {
      mint: new PublicKey(token),
    },
    {
      encoding: 'jsonParsed',
    }
  )

  if (!value) {
    throw new Error('No associated token account found')
  }

  const isToken2022 = value[0].account.owner == token2022ProgramId

  return {
    address: value[0].pubkey,
    isToken2022: isToken2022,
  }
}
