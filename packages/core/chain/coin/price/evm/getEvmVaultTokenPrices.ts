import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { FiatCurrency } from '@vultisig/core-config/FiatCurrency'
import { isEmpty } from '@vultisig/lib-utils/array/isEmpty'
import { attempt } from '@vultisig/lib-utils/attempt'
import { toEntries } from '@vultisig/lib-utils/record/toEntries'
import { Address, erc20Abi } from 'viem'

import { getCoinPrices } from '../getCoinPrices'

type EvmVaultToken = {
  underlyingId: Address
  underlyingPriceProviderId: string
}

/**
 * EVM staking-vault receipt tokens priced by redemption value instead of a
 * market feed. These tokens barely trade, so market quotes (LiFi included) go
 * stale; what a holder can actually redeem is
 * `underlying price x underlying.balanceOf(vault) / vault.totalSupply()`.
 * Keys are lowercase receipt-token addresses; the vault and its underlying
 * must share decimals for the unscaled ratio to hold.
 */
const navPricedEvmTokens: Partial<Record<EvmChain, Record<Address, EvmVaultToken>>> = {
  [EvmChain.Ethereum]: {
    // vTHOR: xSushi-style THOR staking vault (vultisig-windows#4732).
    '0x815c23eca83261b6ec689b60cc4a58b54bc24d8d': {
      underlyingId: '0xa5f2211b9b8170f694421f2046281775e8468044',
      underlyingPriceProviderId: 'thorswap',
    },
  },
}

type GetEvmVaultTokenPricesInput = {
  ids: string[]
  chain: EvmChain
  fiatCurrency?: FiatCurrency
}

/**
 * Prices the NAV-priced vault receipts among `ids`, keyed by lowercase
 * contract address; unregistered ids are ignored. A vault whose on-chain
 * reads or underlying quote fail is omitted so callers can fall back to
 * other sources.
 */
export const getEvmVaultTokenPrices = async ({
  ids,
  chain,
  fiatCurrency,
}: GetEvmVaultTokenPricesInput): Promise<Record<string, number>> => {
  const registry = navPricedEvmTokens[chain] ?? {}
  const requestedIds = new Set(ids.map(id => id.toLowerCase()))
  const vaults = toEntries(registry).filter(({ key }) => requestedIds.has(key))
  if (isEmpty(vaults)) return {}

  const client = getEvmClient(chain)

  const prices: Record<string, number> = {}

  await Promise.all(
    vaults.map(async ({ key: vaultId, value: { underlyingId, underlyingPriceProviderId } }) => {
      const result = await attempt(async () => {
        const [underlyingBalance, vaultSupply, underlyingPrices] = await Promise.all([
          client.readContract({
            address: underlyingId,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [vaultId],
          }),
          client.readContract({
            address: vaultId,
            abi: erc20Abi,
            functionName: 'totalSupply',
          }),
          getCoinPrices({ ids: [underlyingPriceProviderId], fiatCurrency }),
        ])

        const underlyingPrice = underlyingPrices[underlyingPriceProviderId]
        if (!Number.isFinite(underlyingPrice) || underlyingPrice <= 0 || vaultSupply === 0n) {
          throw new Error(`Cannot derive NAV for ${vaultId} on ${chain}`)
        }

        return (Number(underlyingBalance) / Number(vaultSupply)) * underlyingPrice
      })

      if ('error' in result) return

      prices[vaultId] = result.data
    })
  )

  return prices
}
