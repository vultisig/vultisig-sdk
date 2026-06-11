import { UtxoChain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getBlockchairBaseUrl } from './getBlockchairBaseUrl'

type BlockchairAddressResponse = {
  data: {
    [address: string]: {
      address: {
        balance: number
        unspent_output_count?: number
      }
      utxo: {
        block_id: number
        transaction_hash: string
        index: number
        value: number
        value_usd: number
        recipient: string
        script_hex: string
        is_from_coinbase: boolean
        is_spendable?: boolean
      }[]
    }
  }
}

const blockchairUtxoPageSize = 1_000

const getAddressInfoUrl = ({
  address,
  chain,
  offset,
}: ChainAccount<UtxoChain> & {
  offset: number
}) => `${getBlockchairBaseUrl(chain)}/dashboards/address/${address}?limit=${blockchairUtxoPageSize}&offset=${offset}`

export const getUtxoAddressInfo = async (account: ChainAccount<UtxoChain>) => {
  const utxo: BlockchairAddressResponse['data'][string]['utxo'] = []
  let firstPage: BlockchairAddressResponse | undefined

  for (let offset = 0; ; offset += blockchairUtxoPageSize) {
    const page = await queryUrl<BlockchairAddressResponse>(getAddressInfoUrl({ ...account, offset }))
    firstPage ??= page

    const entry = page.data[account.address]
    const pageUtxos = entry?.utxo ?? []
    utxo.push(...pageUtxos)

    const expectedUtxoCount = entry?.address.unspent_output_count
    const hasAllReportedUtxos = expectedUtxoCount !== undefined && utxo.length >= expectedUtxoCount
    const hasNoMorePages = expectedUtxoCount === undefined && pageUtxos.length < blockchairUtxoPageSize

    if (expectedUtxoCount !== undefined && pageUtxos.length === 0 && utxo.length < expectedUtxoCount) {
      throw new Error(
        `Blockchair returned ${utxo.length} UTXOs for ${account.chain}:${account.address}, expected ${expectedUtxoCount}`
      )
    }

    if (hasAllReportedUtxos || pageUtxos.length === 0 || hasNoMorePages) {
      break
    }
  }

  if (!firstPage) {
    throw new Error(`Failed to fetch UTXO address info for ${account.chain}:${account.address}`)
  }

  const firstEntry = firstPage.data[account.address]
  if (firstEntry) {
    firstEntry.utxo = utxo
  }

  return firstPage
}
