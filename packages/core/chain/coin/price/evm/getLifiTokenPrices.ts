import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { attempt } from '@vultisig/lib-utils/attempt'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { addQueryParams } from '@vultisig/lib-utils/query/addQueryParams'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

const lifiTokenBaseUrl = 'https://li.quest/v1/token'

type LifiTokenResponse = {
  priceUSD?: string
}

type GetLifiTokenPricesInput = {
  ids: string[]
  chain: EvmChain
}

export type LifiTokenPrices = {
  prices: Record<string, number>
  failedIds: string[]
}

/** LI.FI prices in USD, keyed by lowercase contract. A 4xx other than 429 means unlisted. Other failures are reported. */
export const getLifiTokenPrices = async ({ ids, chain }: GetLifiTokenPricesInput): Promise<LifiTokenPrices> => {
  const chainId = hexToNumber(getEvmChainId(chain))
  const prices: Record<string, number> = {}
  const failedIds: string[] = []

  await Promise.all(
    ids.map(async id => {
      const result = await attempt(
        queryUrl<LifiTokenResponse>(addQueryParams(lifiTokenBaseUrl, { chain: chainId, token: id }))
      )
      if ('error' in result) {
        if (!isUnlisted(result.error)) failedIds.push(id.toLowerCase())
        return
      }

      const price = Number(result.data.priceUSD)
      if (Number.isFinite(price) && price > 0) {
        prices[id.toLowerCase()] = price
      }
    })
  )

  return { prices, failedIds }
}

const isUnlisted = (error: unknown): boolean =>
  error instanceof HttpResponseError && error.status >= 400 && error.status < 500 && error.status !== 429
