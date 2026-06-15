import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCustomRpcOverride } from '@vultisig/core-chain/chains/customRpc/customRpcOverrides'
import { AccountCoinKey } from '@vultisig/core-chain/coin/AccountCoin'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { base64Encode } from '@vultisig/lib-utils/base64Encode'

type CosmosWasmContract = {
  chain: CosmosChain
  id: string
}

export const cosmosRpcUrl: Record<CosmosChain, string> = {
  Cosmos: 'https://cosmos-rest.publicnode.com',
  Osmosis: 'https://osmosis-rest.publicnode.com',
  Dydx: 'https://dydx-rest.publicnode.com',
  // kujira-rest.publicnode.com returns HTTP 403 "unsupported platform"; use polkachu
  // (same provider Noble uses below + COSMOS_LCD_FALLBACK_URLS in getCosmosAccountInfo).
  Kujira: 'https://kujira-api.polkachu.com',
  Terra: 'https://terra-lcd.publicnode.com',
  TerraClassic: 'https://terra-classic-lcd.publicnode.com',
  Noble: 'https://noble-api.polkachu.com',
  THORChain: 'https://gateway.liquify.com/chain/thorchain_api',
  MayaChain: 'https://mayanode.mayachain.info',
  Akash: 'https://akash-rest.publicnode.com',
}

export const isCosmosWasmTokenId = (id?: string): id is string => {
  if (!id || id.startsWith('ibc/') || id.startsWith('factory/')) {
    return false
  }

  const wasmTokenPattern = /^[a-z]+1[a-z0-9]{20,80}$/

  return wasmTokenPattern.test(id)
}

export const getCosmosWasmSmartQueryUrl = ({ chain, id }: CosmosWasmContract, query: object) =>
  `${getCustomRpcOverride(chain) ?? cosmosRpcUrl[chain]}/cosmwasm/wasm/v1/contract/${id}/smart/${base64Encode(JSON.stringify(query))}`

export const getCosmosWasmTokenBalanceUrl = ({ chain, id, address }: AccountCoinKey<CosmosChain>) =>
  getCosmosWasmSmartQueryUrl(
    {
      chain,
      id: shouldBePresent(id),
    },
    { balance: { address } }
  )

export const getCosmosWasmTokenInfoUrl = (input: CosmosWasmContract) =>
  getCosmosWasmSmartQueryUrl(input, { token_info: {} })
