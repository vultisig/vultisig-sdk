import { type ChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'
import type { CoinBalanceResolverInput } from '@vultisig/core-chain/coin/balance/resolver'

type BalanceResolver = (input: CoinBalanceResolverInput) => Promise<bigint>

// sdk#1372: key this by ChainKind (not string) so a new kind added to core BREAKS the RN build too -
// core keys its own dispatch as Record<ChainKind, ...>, but the RN re-declaration as Record<string, ...>
// meant a new kind compiled fine on RN and only threw at runtime (the platform users are actually on).
const resolverLoaders: Record<ChainKind, () => Promise<BalanceResolver>> = {
  bittensor: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/bittensor').then(
      m => m.getBittensorCoinBalance as BalanceResolver
    ),
  cardano: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/cardano').then(m => m.getCardanoCoinBalance as BalanceResolver),
  cosmos: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/cosmos').then(m => m.getCosmosCoinBalance as BalanceResolver),
  evm: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/evm').then(m => m.getEvmCoinBalance as BalanceResolver),
  polkadot: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/polkadot').then(
      m => m.getPolkadotCoinBalance as BalanceResolver
    ),
  qbtc: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/qbtc').then(m => m.getQbtcCoinBalance as BalanceResolver),
  ripple: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/ripple').then(m => m.getRippleCoinBalance as BalanceResolver),
  solana: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/solana').then(m => m.getSolanaCoinBalance as BalanceResolver),
  sui: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/sui').then(m => m.getSuiCoinBalance as BalanceResolver),
  ton: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/ton').then(m => m.getTonCoinBalance as BalanceResolver),
  tron: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/tron').then(m => m.getTronCoinBalance as BalanceResolver),
  utxo: () =>
    import('@vultisig/core-chain/coin/balance/resolvers/utxo').then(m => m.getUtxoCoinBalance as BalanceResolver),
}

export async function getCoinBalance(input: CoinBalanceResolverInput): Promise<bigint> {
  const kind = getChainKind(input.chain)
  const loadResolver = resolverLoaders[kind]

  if (!loadResolver) {
    throw new Error(`No coin balance resolver registered for chain kind: ${kind}`)
  }

  const resolver = await loadResolver()
  return resolver(input)
}
