// import { Address } from '@solana/web3.js' // Using dynamic import instead

import { getSolanaClient } from '../client'
import { token2022ProgramId } from '../config'
import { splTokenProgramId } from '../config'

export const getSplAccounts = async (address: string) => {
  const { Address } = await import('@solana/web3.js')
  const client = await getSolanaClient()
  const programs = [splTokenProgramId, token2022ProgramId]

  const responses = await Promise.all(
    programs.map(programId =>
      client
        .getTokenAccountsByOwner(
          address as any,
          {
            programId: programId as any,
          },
          {
            encoding: 'jsonParsed',
          }
        )
        .send()
    )
  )

  return responses.flatMap(response => response.value)
}
