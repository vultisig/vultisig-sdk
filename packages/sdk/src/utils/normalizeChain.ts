import { Chain } from '@vultisig/core-chain/Chain'

/**
 * Thrown when a chain string cannot be resolved to a known Chain.
 * Error message lists the canonical chain names to help LLM callers recover.
 */
export class UnknownChainError extends Error {
  override readonly name = 'UnknownChainError'

  constructor(input: string, known: string[]) {
    super(`Unknown chain "${input}". Known chains: ${known.join(', ')}.`)
  }
}

// Alias table: lowercase key -> Chain value.
// Generated from the Chain enum plus hand-curated common aliases (tickers,
// nicknames, hyphenated/camelcase variants) that users and LLMs typically use.
const aliasToChain: Record<string, Chain> = {
  // Bitcoin & UTXO
  btc: Chain.Bitcoin,
  bitcoin: Chain.Bitcoin,
  bch: Chain.BitcoinCash,
  bitcoincash: Chain.BitcoinCash,
  'bitcoin-cash': Chain.BitcoinCash,
  ltc: Chain.Litecoin,
  litecoin: Chain.Litecoin,
  doge: Chain.Dogecoin,
  dogecoin: Chain.Dogecoin,
  dash: Chain.Dash,
  zec: Chain.Zcash,
  zcash: Chain.Zcash,

  // EVM
  eth: Chain.Ethereum,
  ethereum: Chain.Ethereum,
  bnb: Chain.BSC,
  bsc: Chain.BSC,
  binance: Chain.BSC,
  binancesmartchain: Chain.BSC,
  matic: Chain.Polygon,
  polygon: Chain.Polygon,
  arb: Chain.Arbitrum,
  arbitrum: Chain.Arbitrum,
  op: Chain.Optimism,
  optimism: Chain.Optimism,
  avax: Chain.Avalanche,
  avalanche: Chain.Avalanche,
  base: Chain.Base,
  blast: Chain.Blast,
  zksync: Chain.Zksync,
  zk: Chain.Zksync,
  mnt: Chain.Mantle,
  mantle: Chain.Mantle,
  cro: Chain.CronosChain,
  cronos: Chain.CronosChain,
  cronoschain: Chain.CronosChain,
  hype: Chain.Hyperliquid,
  hyperliquid: Chain.Hyperliquid,
  sei: Chain.Sei,

  // Cosmos ecosystem
  thor: Chain.THORChain,
  thorchain: Chain.THORChain,
  rune: Chain.THORChain,
  maya: Chain.MayaChain,
  mayachain: Chain.MayaChain,
  cacao: Chain.MayaChain,
  atom: Chain.Cosmos,
  cosmos: Chain.Cosmos,
  osmo: Chain.Osmosis,
  osmosis: Chain.Osmosis,
  kuji: Chain.Kujira,
  kujira: Chain.Kujira,
  luna: Chain.Terra,
  terra: Chain.Terra,
  terraclassic: Chain.TerraClassic,
  lunc: Chain.TerraClassic,
  noble: Chain.Noble,
  akt: Chain.Akash,
  akash: Chain.Akash,
  dydx: Chain.Dydx,

  // Other
  sol: Chain.Solana,
  solana: Chain.Solana,
  sui: Chain.Sui,
  ton: Chain.Ton,
  dot: Chain.Polkadot,
  polkadot: Chain.Polkadot,
  tao: Chain.Bittensor,
  bittensor: Chain.Bittensor,
  ada: Chain.Cardano,
  cardano: Chain.Cardano,
  trx: Chain.Tron,
  tron: Chain.Tron,
  xrp: Chain.Ripple,
  ripple: Chain.Ripple,
  qbtc: Chain.QBTC,
}

// Also accept each canonical Chain enum value (case-insensitive).
for (const value of Object.values(Chain)) {
  aliasToChain[value.toLowerCase()] = value
}

/**
 * Resolve a case-insensitive chain string (canonical name, ticker, or common
 * alias) to the SDK's canonical Chain value.
 *
 * Accepts:
 * - Canonical Chain enum values (`"Ethereum"`, `"Bitcoin"`, `"Bitcoin-Cash"`, ...)
 * - Tickers (`"btc"`, `"eth"`, `"sol"`, ...)
 * - Common aliases (`"bitcoin"`, `"binance"`, `"thorchain"`, ...)
 *
 * @throws {UnknownChainError} When the input cannot be resolved.
 */
export const normalizeChain = (input: string): Chain => {
  const key = input?.trim().toLowerCase() ?? ''
  const resolved = aliasToChain[key]
  if (resolved) return resolved

  const known = Object.values(Chain).map(c => c.toLowerCase())
  throw new UnknownChainError(input ?? '', known)
}
