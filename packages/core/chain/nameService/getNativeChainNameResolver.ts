import { Chain } from '@vultisig/core-chain/Chain'
import {
  getNativeSwapChainId,
  nativeSwapApiBaseUrl,
  NativeSwapChain,
  nativeSwapEnabledChainsRecord,
} from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { NameServiceResolver } from './resolver'

type NativeChainNameRecord = {
  owner?: string
  aliases?: { chain: string; address: string }[]
}

const nameRecordPath: Record<NativeSwapChain, string> = {
  [Chain.THORChain]: 'thorname',
  [Chain.MayaChain]: 'mayaname',
}

// THORNode and MAYANode report a name that was never registered as an
// internal error saying so ("THORName doesn't exist"), not as a 404.
const isMissingNameError = (error: unknown) =>
  error instanceof HttpResponseError && (error.status === 404 || /doesn.t exist/i.test(error.message))

/**
 * Builds the resolver for a THORChain-style name service (THORName, MAYAName).
 * Both nodes return the same record, with aliases keyed by the chain
 * identifiers their pools use (BTC, ETH, GAIA, ...). A name can hold an
 * address only for a chain its own network trades: a THORName has no Dash
 * alias, a MAYAName no BSC one.
 */
export const getNativeChainNameResolver = (nativeChain: NativeSwapChain): NameServiceResolver => ({
  isChainSupported: chain => isOneOf(chain, nativeSwapEnabledChainsRecord[nativeChain]),
  resolve: async ({ name, chain }) => {
    const chainId = shouldBePresent(getNativeSwapChainId(chain), `${nativeChain} name chain id for ${chain}`)
    const label = name.slice(0, name.lastIndexOf('.'))

    let record: NativeChainNameRecord
    try {
      record = await queryUrl<NativeChainNameRecord>(
        `${nativeSwapApiBaseUrl[nativeChain]}/${nameRecordPath[nativeChain]}/${encodeURIComponent(label)}`
      )
    } catch (error) {
      if (isMissingNameError(error)) {
        return { kind: 'notFound' }
      }
      throw error
    }

    const aliases = record.aliases ?? []
    // An expired name comes back as a blank record: no owner and no aliases.
    if (!record.owner && aliases.length === 0) {
      return { kind: 'notFound' }
    }

    const alias = aliases.find(alias => alias.chain.toUpperCase() === chainId)

    return alias ? { kind: 'resolved', address: alias.address } : { kind: 'noAddressForChain' }
  },
})
