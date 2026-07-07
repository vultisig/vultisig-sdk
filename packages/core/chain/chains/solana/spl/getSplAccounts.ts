import { PublicKey } from '@solana/web3.js'

import { getSolanaClient } from '../client'
import { splTokenProgramId, token2022ProgramId } from '../config'

export const getSplAccounts = async (address: string) => {
  const client = getSolanaClient()
  const programs = [splTokenProgramId, token2022ProgramId]
  const owner = new PublicKey(address)

  // Query the SPL Token and Token-2022 programs independently. Previously this
  // used Promise.all, so a transient RPC failure on EITHER program's query
  // rejected the whole call and hid the other program's holdings entirely (a
  // user with normal SPL tokens would see nothing if only the token-2022 query
  // hiccuped). Use allSettled: return whatever succeeded, and only throw when
  // BOTH fail (so a real outage surfaces an error rather than a false-empty
  // "you have no tokens").
  const responses = await Promise.allSettled(
    programs.map(programId => client.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(programId) }))
  )

  const fulfilled = responses.filter(
    (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof client.getParsedTokenAccountsByOwner>>> =>
      r.status === 'fulfilled'
  )

  if (fulfilled.length === 0) {
    const firstRejection = responses.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    throw firstRejection?.reason ?? new Error('getSplAccounts: all token-program queries failed')
  }

  return fulfilled.flatMap(response => response.value.value)
}
