// RN override for `@vultisig/core-chain/chains/solana/spl/getSplAssociatedAccount`.
//
// Same rationale as the `getSplAccounts` override: `@solana/web3.js` evaluation
// drags in `ws` / `rpc-websockets` which Hermes can't handle. We preserve the
// public signature exactly (`{account, token} -> {address, isToken2022}`)
// and defer the `@solana/web3.js` import to inside the async body.
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { token2022ProgramId } from '@vultisig/core-chain/chains/solana/config'

type Input = {
  account: string
  token: string
}

export const getSplAssociatedAccount = async ({
  account,
  token,
}: Input): Promise<{ address: string; isToken2022: boolean }> => {
  const client = getSolanaClient()
  const { PublicKey } = await import('@solana/web3.js')

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
