import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { getUtxoAddressInfo } from '@vultisig/core-chain/chains/utxo/client/getUtxoAddressInfo'

import { ClaimableUtxo } from './ClaimableUtxo'

type GetClaimableUtxosInput = {
  btcAddress: string
}

/**
 * Asks the QBTC chain whether a given UTXO is still claimable
 * (i.e. registered + unclaimed) via `GET /qbtc/v1/utxo/{txid}/{vout}`.
 *
 * - 200 → claimable
 * - 404 → already claimed or never registered
 * - other → propagated as a hard error so transient network failures
 *   don't silently drop UTXOs from the user's list.
 */
const isUtxoClaimableOnChain = async ({
  txid,
  vout,
}: {
  txid: string
  vout: number
}): Promise<boolean> => {
  const response = await fetch(`${qbtcRestUrl}/qbtc/v1/utxo/${txid}/${vout}`)
  if (response.ok) return true
  if (response.status === 404) return false
  throw new Error(
    `Failed to verify UTXO ${txid}:${vout} on QBTC chain (${response.status} ${response.statusText})`
  )
}

/**
 * Fetches Bitcoin UTXOs for the given address via Blockchair and filters
 * out any the QBTC chain has already paid out.
 *
 * Bitcoin doesn't know about QBTC claims, so a Blockchair UTXO can still
 * appear "spendable" after the QBTC chain has consumed it. Cross-checking
 * against the chain's UTXO endpoint (btcq-org/qbtc#141) prevents the user
 * from selecting a stale entry and burning ~90s on a no-op claim.
 */
export const getClaimableUtxos = async ({
  btcAddress,
}: GetClaimableUtxosInput): Promise<ClaimableUtxo[]> => {
  const response = await getUtxoAddressInfo({
    address: btcAddress,
    chain: Chain.Bitcoin,
  })

  const btcUtxos = response.data[btcAddress]?.utxo ?? []

  const candidates: ClaimableUtxo[] = btcUtxos.map(
    ({ transaction_hash, index, value }) => ({
      txid: transaction_hash,
      vout: index,
      amount: value,
    })
  )

  const claimableFlags = await Promise.all(
    candidates.map(({ txid, vout }) => isUtxoClaimableOnChain({ txid, vout }))
  )

  return candidates.filter((_, i) => claimableFlags[i])
}
