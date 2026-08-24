import { Chain } from '@vultisig/core-chain/Chain'

const aliases: Record<string, Chain> = {
  // EVM
  ethereum: Chain.Ethereum,
  arbitrum: Chain.Arbitrum,
  optimism: Chain.Optimism,
  polygon: Chain.Polygon,
  base: Chain.Base,
  avalanche: Chain.Avalanche,
  blast: Chain.Blast,
  cronoschain: Chain.CronosChain,
  zksync: Chain.Zksync,
  mantle: Chain.Mantle,
  hyperliquid: Chain.Hyperliquid,
  sei: Chain.Sei,
  bsc: Chain.BSC,
  binancesmartchain: Chain.BSC,
  smartchain: Chain.BSC,

  // UTXO
  bitcoin: Chain.Bitcoin,
  'bitcoin-cash': Chain.BitcoinCash,
  dogecoin: Chain.Dogecoin,
  litecoin: Chain.Litecoin,
  dash: Chain.Dash,
  zcash: Chain.Zcash,

  // Cosmos
  cosmos: Chain.Cosmos,
  gaia: Chain.Cosmos,
  gaiachain: Chain.Cosmos,
  kujira: Chain.Kujira,
  osmosis: Chain.Osmosis,
  dydx: Chain.Dydx,
  noble: Chain.Noble,
  akash: Chain.Akash,
  thorchain: Chain.THORChain,
  mayachain: Chain.MayaChain,
  terra: Chain.Terra,
  terraclassic: Chain.TerraClassic,

  solana: Chain.Solana,
  ripple: Chain.Ripple,
  ton: Chain.Ton,
  tron: Chain.Tron,
  polkadot: Chain.Polkadot,
  cardano: Chain.Cardano,
  sui: Chain.Sui,
  bittensor: Chain.Bittensor,
  qbtc: Chain.QBTC,
}

export const resolveChainFromFixture = (s: string): Chain => {
  const key = (s ?? '').toLowerCase().trim()
  const chain = aliases[key]
  if (!chain) throw new Error(`Unknown chain in fixtures: "${s}"`)
  return chain
}
