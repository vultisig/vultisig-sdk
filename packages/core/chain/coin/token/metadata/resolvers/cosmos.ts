import { CosmosChain } from '@vultisig/core-chain/Chain'
import {
  cosmosRpcUrl,
  getCosmosWasmTokenInfoUrl,
  isCosmosWasmTokenId,
} from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { CoinMetadata } from '@vultisig/core-chain/coin/Coin'
import { knownCosmosTokens } from '@vultisig/core-chain/coin/knownTokens/cosmos'
import { TokenMetadataResolver } from '@vultisig/core-chain/coin/token/metadata/resolver'
import { getLastItem } from '@vultisig/lib-utils/array/getLastItem'
import { attempt } from '@vultisig/lib-utils/attempt'
import { asyncFallbackChain } from '@vultisig/lib-utils/promise/asyncFallbackChain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type DenomUnits = { denom: string; exponent: number }
type DenomMetadata = {
  base?: string
  symbol?: string
  display?: string
  denom_units?: DenomUnits[]
}
type Cw20TokenInfo = {
  name?: string
  symbol?: string
  decimals?: number
}

const decimalsFromMeta = (meta: DenomMetadata): number | null => {
  if (!meta.denom_units || !meta.display) return null
  const unit = meta.denom_units.find(u => u.denom === (meta.symbol || meta.display))
  return unit?.exponent ?? null
}

const deriveTicker = (denom: string, meta: DenomMetadata): string => {
  if (meta.symbol) return meta.symbol
  if (meta.display) return meta.display

  if (denom.startsWith('x/staking-')) {
    const base = denom.replace('x/staking-', '')
    return `S${base}`
  }
  if (denom.startsWith('x/')) {
    return getLastItem(denom.split('/'))
  }
  if (denom.startsWith('factory/')) {
    const sub = getLastItem(denom.split('/'))
    return sub.replace(/^u/, '')
  }
  return denom
}

const getDenomMetaFromLCD = async (lcdBase: string, denom: string): Promise<DenomMetadata | null> => {
  return asyncFallbackChain(
    async () => {
      const byDenom = `${lcdBase}/cosmos/bank/v1beta1/denoms_metadata/${encodeURIComponent(denom)}`
      const byDenomRes = await attempt(() => queryUrl<{ metadata?: DenomMetadata }>(byDenom))
      if (byDenomRes.data?.metadata) return byDenomRes.data.metadata
      throw new Error('Could not fetch metadata byDenom')
    },
    async () => {
      const listUrl = `${lcdBase}/cosmos/bank/v1beta1/denoms_metadata?pagination.limit=1000`
      const listRes = await attempt(() => queryUrl<{ metadatas?: DenomMetadata[] }>(listUrl))
      return listRes.data?.metadatas?.find(data => data.base === denom) ?? null
    }
  )
}

const getCw20MetaFromLCD = async (chain: CosmosChain, id: string): Promise<CoinMetadata> => {
  const { data } = await queryUrl<{ data?: Cw20TokenInfo }>(getCosmosWasmTokenInfoUrl({ chain, id }))
  const ticker = data?.symbol?.trim()
  if (!ticker) throw new Error(`Could not fetch CW20 symbol for ${id}`)

  const decimals = data?.decimals
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Could not fetch CW20 decimals for ${id}`)
  }

  return {
    ticker,
    decimals,
  }
}

export const getCosmosTokenMetadata: TokenMetadataResolver<CosmosChain> = async ({ chain, id }) => {
  const knownMeta = knownCosmosTokens[chain]?.[id]
  if (knownMeta) {
    return {
      ticker: knownMeta.ticker,
      decimals: knownMeta.decimals,
    }
  }

  if (isCosmosWasmTokenId(id)) {
    return asyncFallbackChain(
      async () => getCw20MetaFromLCD(chain, id),
      async () => {
        const lcd = cosmosRpcUrl[chain]
        const meta = await getDenomMetaFromLCD(lcd, id)
        if (!meta) throw new Error(`No denom meta information available for ${id}`)
        const decimals = decimalsFromMeta(meta)
        if (decimals === null) throw new Error(`Could not fetch decimal for ${id}`)
        const ticker = deriveTicker(id, meta)

        return {
          ticker,
          decimals,
        }
      }
    )
  }

  const lcd = cosmosRpcUrl[chain]
  const meta = await getDenomMetaFromLCD(lcd, id)
  if (!meta) throw new Error(`No denom meta information available for ${id}`)
  const decimals = decimalsFromMeta(meta)
  if (decimals === null) throw new Error(`Could not fetch decimal for ${id}`)
  const ticker = deriveTicker(id, meta)

  return {
    ticker,
    decimals,
  }
}
