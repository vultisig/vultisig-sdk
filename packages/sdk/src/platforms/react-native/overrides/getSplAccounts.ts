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
  const owner = new PublicKey(address)

  // Mirror the core resolver: query the SPL Token and Token-2022 programs
  // independently with allSettled so a transient RPC failure on EITHER program
  // doesn't hide the other's holdings; only throw when BOTH fail (a real outage
  // surfaces an error rather than a false-empty "you have no tokens"). Keeping
  // this in lockstep with core/getSplAccounts avoids platform-divergent
  // behavior on Hermes/RN, where this override is what actually runs.
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
