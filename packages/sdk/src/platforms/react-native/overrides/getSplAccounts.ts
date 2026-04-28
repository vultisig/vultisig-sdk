// RN override for `@vultisig/core-chain/chains/solana/spl/getSplAccounts`.
//
// The core module statically imports `PublicKey` from `@solana/web3.js`,
// which transitively pulls `rpc-websockets` → `ws` at module-init — both
// absent on Hermes. To keep RN loadable, we mirror the public surface
// exactly (`getSplAccounts(address): Promise<...>`) but lazy-import
// `@solana/web3.js` inside the async body so the dep only evaluates when
// the function is actually invoked.
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { splTokenProgramId, token2022ProgramId } from '@vultisig/core-chain/chains/solana/config'

export const getSplAccounts = async (address: string) => {
  const client = getSolanaClient()
  const { PublicKey } = await import('@solana/web3.js')
  const programs = [splTokenProgramId, token2022ProgramId]

  const responses = await Promise.all(
    programs.map(programId =>
      client.getParsedTokenAccountsByOwner(new PublicKey(address), {
        programId: new PublicKey(programId),
      })
    )
  )

  return responses.flatMap(response => response.value)
}
