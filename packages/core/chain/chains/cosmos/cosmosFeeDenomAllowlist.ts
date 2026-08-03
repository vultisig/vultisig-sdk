import { CosmosChain } from '@vultisig/core-chain/Chain'

import { cosmosFeeCoinDenom } from './cosmosFeeCoinDenom'

/**
 * Non-native denoms a chain's ante handler additionally accepts as a gas fee,
 * beyond its own native `cosmosFeeCoinDenom`. A chain absent here (or with no
 * entry) accepts ONLY its native denom.
 *
 * TerraClassic (columbus-5): live-verified 2026-05-28 deep spike — 3.6% of
 * recent columbus-5 txs paid fee in `uusd` (USTC), all succeeded
 * (tx_response.code: 0), confirmed for MsgWithdrawDelegatorReward /
 * MsgDelegate / MsgBeginRedelegate at heights 28810338 / 28810677 / 28810409.
 * Minimum gas price for uusd = 0.75 uusd/gas (network floor, pinned across
 * all 9 observed minimum-fee txs).
 *
 * Osmosis: the x/txfees module whitelists IBC tokens for fee payment
 * (/osmosis/txfees/v1beta1/fee_tokens has 173+ entries) — hardcoding the
 * top-3 stable/common ones (ATOM, Noble USDC, Axelar USDC) rather than a live
 * LCD query on every fee-denom validation. IBC hashes verified against
 * osmosis-rest.publicnode.com chain-registry 2026-05-31.
 */
const COSMOS_ALTERNATE_FEE_DENOMS: Partial<Record<CosmosChain, readonly string[]>> = {
  [CosmosChain.TerraClassic]: ['uusd'],
  [CosmosChain.Osmosis]: [
    // ATOM from Cosmos Hub (pool 1 - highest liquidity osmosis IBC pair)
    'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
    // USDC from Noble (pool 1464 - primary USDC venue on Osmosis)
    'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4',
    // axlUSDC from Axelar (pool 678 - legacy USDC before Noble)
    'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858',
  ],
}

/**
 * Denoms this SDK will build a tx fee in for `chain`: the chain's own native
 * denom plus the curated alternates above. This is NOT the exhaustive list of
 * every denom the chain's ante handler would accept (Osmosis's real
 * `/osmosis/txfees/v1beta1/fee_tokens` whitelist has 173+ entries) — it's the
 * deliberately-curated subset we support without a live LCD query. Rejecting
 * a `fee_denom` outside this list is a fail-closed product choice (ask the
 * user to pick a supported denom), not a claim that the chain itself would
 * reject it.
 */
export const getCosmosAllowedFeeDenoms = (chain: CosmosChain): readonly string[] => [
  cosmosFeeCoinDenom[chain],
  ...(COSMOS_ALTERNATE_FEE_DENOMS[chain] ?? []),
]

/** True when `feeDenom` is one of this SDK's supported gas-fee denoms for `chain` (see {@link getCosmosAllowedFeeDenoms}). */
export const isCosmosFeeDenomAllowed = (chain: CosmosChain, feeDenom: string): boolean =>
  getCosmosAllowedFeeDenoms(chain).includes(feeDenom)
