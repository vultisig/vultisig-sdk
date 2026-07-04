import { EvmChain } from '@vultisig/core-chain/Chain'

/**
 * River Omni-CDP (Satoshi) deployed contract addresses, per supported EVM chain.
 *
 * Sourced from River's public docs:
 *   https://docs.river.inc/outro/deployed-contracts/<docsSlug>
 *
 * River is a Liquity-style collateralized-debt-position (CDP) protocol: a user
 * locks collateral in a "trove" and mints satUSD against it. These are the
 * canonical system contracts used to build the borrower-operations calldata.
 */
export type RiverChain = Extract<EvmChain, 'Ethereum' | 'BSC' | 'Arbitrum' | 'Base'>

export const RIVER_SUPPORTED_CHAINS: readonly RiverChain[] = [
  EvmChain.Ethereum,
  EvmChain.BSC,
  EvmChain.Arbitrum,
  EvmChain.Base,
] as RiverChain[]

export type RiverChainConfig = {
  /** docs.river.inc slug for the deployed-contracts page. */
  docsSlug: string
  /** SatoshiCore "app" diamond — the BorrowerOperations / Factory entrypoint. */
  app: `0x${string}`
  /** satUSD stablecoin token (the minted debt asset, 18 decimals). */
  satUsd: `0x${string}`
  /** BorrowerOperations facet of the app diamond. */
  borrowerOperationsFacet: `0x${string}`
  /** Factory facet of the app diamond (discovers trove managers). */
  factoryFacet: `0x${string}`
  /** SatoshiPeriphery — the delegate router that wraps open/close trove calls. */
  periphery: `0x${string}`
  /** Wrapped-native token address, when this chain exposes a native-collateral market. */
  wrappedNative?: `0x${string}`
}

export const RIVER_CHAIN_CONFIG: Record<RiverChain, RiverChainConfig> = {
  Ethereum: {
    docsSlug: 'ethereum',
    app: '0xb8374e4DfF99202292da2FE34425e1dE665b67E6',
    satUsd: '0x1958853A8BE062dc4f401750Eb233f5850F0D0d2',
    borrowerOperationsFacet: '0x32db5c3D64aa7e100B73786000704aee61072981',
    factoryFacet: '0xB8405B3AF92e5Ed5842bE38B02C3d85b06176922',
    periphery: '0xDC23b633c23a9d6E55Cb454c673F767bf65f920C',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  BSC: {
    docsSlug: 'bnb-chain',
    app: '0x07BbC5A83B83a5C440D1CAedBF1081426d0AA4Ec',
    satUsd: '0xb4818BB69478730EF4e33Cc068dD94278e2766cB',
    borrowerOperationsFacet: '0xb0fE760f651E4098cc0B11572A44E1D15cb3B5F5',
    factoryFacet: '0x89A7e370514328f5c8204d68c75Eb5E194B8F77E',
    periphery: '0x0a1cA3190579504761A0EFd0c94dfA2DeDe55bE2',
  },
  Arbitrum: {
    docsSlug: 'arbitrum',
    app: '0x07BbC5A83B83a5C440D1CAedBF1081426d0AA4Ec',
    satUsd: '0xb4818BB69478730EF4e33Cc068dD94278e2766cB',
    borrowerOperationsFacet: '0xb0fE760f651E4098cc0B11572A44E1D15cb3B5F5',
    factoryFacet: '0x89A7e370514328f5c8204d68c75Eb5E194B8F77E',
    periphery: '0x0a1cA3190579504761A0EFd0c94dfA2DeDe55bE2',
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  Base: {
    docsSlug: 'base',
    app: '0x9a3c724ee9603A7550499bE73DC743B371811dd3',
    satUsd: '0x70654AaD8B7734dc319d0C3608ec7B32e03FA162',
    borrowerOperationsFacet: '0x32CC6E06D9212ABe6aBa8B2720ce1e601E0653e7',
    factoryFacet: '0x0920006d239e8612306435c4044a1Be37349eB1b',
    periphery: '0x9d9f0D9a13d3bA201003DD2e8950059d2c08D782',
    wrappedNative: '0x4200000000000000000000000000000000000006',
  },
}

export const RIVER_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** NICR (nominal collateral ratio) fixed-point scale used by Liquity-style sorted troves. */
export const RIVER_NICR_PRECISION = 10n ** 20n

/** Default max borrowing-fee tolerance, in basis points (5%). */
export const RIVER_DEFAULT_MAX_FEE_BPS = 500n

export const RIVER_TROVE_STATUS_NAMES = [
  'non_existent',
  'active',
  'closed_by_owner',
  'closed_by_liquidation',
  'closed_by_redemption',
] as const

export function isRiverChain(chain: string): chain is RiverChain {
  return (RIVER_SUPPORTED_CHAINS as readonly string[]).includes(chain)
}

export function riverStatusName(status: bigint): string {
  const idx = Number(status)
  return RIVER_TROVE_STATUS_NAMES[idx] ?? `unknown_${status.toString()}`
}
