import { PublicKey } from '@solana/web3.js'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'

import { splTokenProgramId, token2022ProgramId } from '../config'

type Input = {
  account: string
  token: string
}

/**
 * Resolve an existing associated token account for a wallet and mint.
 * Only the deterministic ATA is returned; other token accounts are ignored.
 * Throws when the ATA does not exist, even if the wallet has non-ATA holdings.
 */
export const getSplAssociatedAccount = async ({
  account,
  token,
}: Input): Promise<{ address: string; isToken2022: boolean }> => {
  const client = getSolanaClient()

  const owner = new PublicKey(account)
  const mint = new PublicKey(token)
  const response = await client.getParsedTokenAccountsByOwner(owner, { mint })
  const associatedTokenProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

  // RPC order does not identify the ATA. Its seeds include the token program,
  // so the address must match the account's supported program as well.
  for (const candidate of response.value ?? []) {
    const programId = candidate.account.owner.toBase58()
    if (programId !== splTokenProgramId && programId !== token2022ProgramId) continue

    const [address] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), candidate.account.owner.toBuffer(), mint.toBuffer()],
      associatedTokenProgram
    )
    if (candidate.pubkey.equals(address)) {
      return { address: address.toBase58(), isToken2022: programId === token2022ProgramId }
    }
  }

  throw new Error('No associated token account found')
}
