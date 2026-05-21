import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { getUtxoAddressInfo } from '@vultisig/core-chain/chains/utxo/client/getUtxoAddressInfo'

import { ClaimableUtxo } from './ClaimableUtxo'

type GetClaimableUtxosInput = {
  btcAddress: string
}

type QbtcUtxoResponse = {
  utxo?: {
    txid: string
    vout: number
    amount: string
    entitled_amount: string
  }
}

/**
 * Asks the QBTC chain how much of a given UTXO is still claimable via
 * `GET /qbtc/v1/utxo/{txid}/{vout}`.
 *
 * The chain returns the UTXO record with its remaining `entitled_amount`
 * even after a full payout — `entitled_amount` is `"0"` once consumed.
 * So a 200 alone is not enough; we have to inspect the body. 404 still
 * happens for UTXOs the chain has never registered.
 *
 * Returns `null` when the UTXO is no longer claimable; otherwise returns
 * the remaining entitled amount in satoshis. Other non-2xx responses
 * propagate so transient network failures don't silently drop UTXOs.
 */
const getOnChainEntitledAmount = async ({ txid, vout }: { txid: string; vout: number }): Promise<bigint | null> => {
  const response = await fetch(`${qbtcRestUrl}/qbtc/v1/utxo/${txid}/${vout}`)

  if (response.status === 404) return null

  if (!response.ok) {
    throw new Error(`Failed to verify UTXO ${txid}:${vout} on QBTC chain (${response.status} ${response.statusText})`)
  }

  const body: QbtcUtxoResponse = await response.json()
  const entitled = body.utxo?.entitled_amount
  if (entitled === undefined) return null

  const remaining = BigInt(entitled)
  return remaining > 0n ? remaining : null
}

/**
 * Fetches Bitcoin UTXOs for the given address via Blockchair and filters
 * out any the QBTC chain has already paid out.
 *
 * Bitcoin doesn't know about QBTC claims, so a Blockchair UTXO can still
 * appear "spendable" after the QBTC chain has consumed it. Cross-checking
 * against the chain's UTXO endpoint (btcq-org/qbtc#141) prevents the user
 * from selecting a stale entry and burning ~90s on a no-op claim.
 *
 * The returned `amount` reflects the chain's remaining `entitled_amount`,
 * not the Blockchair-reported BTC value — partial payouts on a UTXO would
 * otherwise mislead the user about what they're about to claim.
 */
export const getClaimableUtxos = async ({ btcAddress }: GetClaimableUtxosInput): Promise<ClaimableUtxo[]> => {
  const response = await getUtxoAddressInfo({
    address: btcAddress,
    chain: Chain.Bitcoin,
  })

  const btcUtxos = response.data[btcAddress]?.utxo ?? []

  const entitledAmounts = await Promise.all(
    btcUtxos.map(({ transaction_hash, index }) => getOnChainEntitledAmount({ txid: transaction_hash, vout: index }))
  )

  return btcUtxos.flatMap(({ transaction_hash, index }, i) => {
    const remaining = entitledAmounts[i]
    if (remaining === null) return []
    return [
      {
        txid: transaction_hash,
        vout: index,
        amount: Number(remaining),
      },
    ]
  })
}
