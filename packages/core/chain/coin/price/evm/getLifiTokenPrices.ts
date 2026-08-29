import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { attempt } from '@vultisig/lib-utils/attempt'
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

/**
 * Prices EVM tokens in USD through LI.FI's token endpoint, keyed by lowercase
 * contract address. Serves as the fallback for contracts CoinGecko does not
 * list (e.g. vTHOR). Tokens LI.FI cannot price are omitted, and per-token
 * request failures are swallowed so one unpriceable token never blocks the
 * rest.
 */
export const getLifiTokenPrices = async ({ ids, chain }: GetLifiTokenPricesInput): Promise<Record<string, number>> => {
  const chainId = hexToNumber(getEvmChainId(chain))

  const prices: Record<string, number> = {}

  await Promise.all(
    ids.map(async id => {
      const result = await attempt(
        queryUrl<LifiTokenResponse>(addQueryParams(lifiTokenBaseUrl, { chain: chainId, token: id }))
      )
      if ('error' in result) return

      const price = Number(result.data.priceUSD)
      if (Number.isFinite(price) && price > 0) {
        prices[id.toLowerCase()] = price
      }
    })
  )

  return prices
}
