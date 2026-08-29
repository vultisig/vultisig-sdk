import {
  isValidKaminoRequestAmount,
  KaminoTokenAmount,
  kaminoTokenAmount,
  kaminoTokenAmountFromBaseUnitString,
  kaminoTokenAmountFromDecimalString,
  kaminoTokenToShareAmountRoundedUp,
} from './amount'
import { fetchKaminoVaultMetrics, fetchKaminoVaultState } from './api'
import { parseKaminoDisplayDecimal } from './decimal'
import { KaminoServiceError } from './KaminoServiceError'
import { KaminoVaultInfo, KaminoVaultStateResponse } from './models'
import { isPositiveKaminoRate, parseKaminoRate } from './rate'
import { getKaminoVaultDescriptor, KaminoVaultDescriptor } from './registry'

/**
 * A margin of one part in this many — a tenth of a percent — added to the
 * published minimum deposit.
 */
const minimumDepositMarginDivisor = 1000n

/**
 * Smallest deposit margin in base units, for a minimum too small for the
 * proportional one to clear a rounding loss. Larger than either measured
 * shortfall (8 and 10 base units on the launch vaults).
 */
const minimumDepositMarginFloor = 16n

/**
 * Multiple of the published minimum a withdraw's token value must reach.
 *
 * The floor measured on-chain sits just above two; the third is margin,
 * because the rule is a reading of observed behaviour rather than a documented
 * contract.
 */
const minimumWithdrawMultiple = 3n

/** The Solana default/system address doubles as "no farm attached". */
const systemProgramAddress = '11111111111111111111111111111111'

/**
 * The smallest deposit a form may offer.
 *
 * The published `minDepositAmount` is in the right unit — unlike its withdraw
 * counterpart — but the program still refuses a deposit *at* it, with
 * `DepositAmountBelowMinimum`. Measured at one base unit of resolution the
 * shortfall is a handful of base units and moves with the share rate — a
 * rounding loss in the share the deposit mints, not a second threshold. The
 * margin is therefore proportional with an absolute floor, both generous
 * against what was measured and both invisible in money.
 */
const effectiveMinimumDeposit = (published: KaminoTokenAmount): KaminoTokenAmount => {
  const proportional = (published.baseUnits + minimumDepositMarginDivisor - 1n) / minimumDepositMarginDivisor
  const margin = proportional > minimumDepositMarginFloor ? proportional : minimumDepositMarginFloor
  return kaminoTokenAmount(published.baseUnits + margin, published.decimals)
}

const malformed = (field: string, value: string) => new KaminoServiceError({ malformedNumber: { field, value } })

const assertFieldMatchesRegistry = (field: string, actual: string, expected: string) => {
  if (actual !== expected) {
    throw new KaminoServiceError({ vaultMetadataMismatch: { field, expected, actual } })
  }
}

/**
 * Refuses a response whose account of the vault differs from the registry's.
 *
 * The mints, their decimals and the farm are immutable properties of a kVault,
 * so this can never fire on a legitimate change. It exists because those
 * values decide where funds go and how amounts are scaled: taking them from
 * the API would mean validating a transaction the API built against values the
 * same API supplied, and the pair could be made consistent. Checking here
 * means the whole feature works from a vault identity the app already knew.
 */
const assertMatchesRegistry = (state: KaminoVaultStateResponse['state'], descriptor: KaminoVaultDescriptor) => {
  assertFieldMatchesRegistry('tokenMint', state.tokenMint, descriptor.tokenMint)
  assertFieldMatchesRegistry('sharesMint', state.sharesMint, descriptor.sharesMint)
  assertFieldMatchesRegistry('tokenMintDecimals', String(state.tokenMintDecimals), String(descriptor.tokenDecimals))
  assertFieldMatchesRegistry('sharesMintDecimals', String(state.sharesMintDecimals), String(descriptor.sharesDecimals))
  assertFieldMatchesRegistry('vaultFarm', normalizeFarm(state.vaultFarm) ?? '', descriptor.farm ?? '')
}

const normalizeFarm = (address: string): string | undefined => {
  if (!address || address === systemProgramAddress) return undefined
  return address
}

/**
 * Hydrates a curated vault with live state and metrics.
 *
 * Takes an address and resolves the descriptor from the registry itself, so
 * descriptor-shaped data from anywhere else can never decide a vault's
 * identity; an address the registry does not carry is refused. The response's
 * account of the vault is then checked against the pinned identity, every
 * numeric field is parsed under the strict decimal rules (a value that fails
 * throws rather than defaulting to zero), and the published minimums are
 * replaced by the effective ones the program actually accepts.
 *
 * Uncached — client layers own caching (and their caches then hold only
 * hydrations that cleared every check here).
 */
export const fetchKaminoVaultInfo = async (vaultAddress: string): Promise<KaminoVaultInfo> => {
  const descriptor = getKaminoVaultDescriptor(vaultAddress)
  if (!descriptor) {
    throw new KaminoServiceError({ vaultNotInRegistry: vaultAddress })
  }

  const [{ state }, metrics] = await Promise.all([
    fetchKaminoVaultState(descriptor.address),
    fetchKaminoVaultMetrics(descriptor.address),
  ])

  assertMatchesRegistry(state, descriptor)

  // The published figures are numbers a remote service hands us, and they end
  // up bounding what a user may spend. A non-positive or absurd one is refused
  // rather than propagated into a minimum nothing can satisfy.
  const publishedMinDeposit = kaminoTokenAmountFromBaseUnitString(state.minDepositAmount, descriptor.tokenDecimals)
  if (!publishedMinDeposit) throw malformed('minDepositAmount', state.minDepositAmount)
  const minDeposit = effectiveMinimumDeposit(publishedMinDeposit)
  if (!isValidKaminoRequestAmount(publishedMinDeposit) || !isValidKaminoRequestAmount(minDeposit)) {
    throw malformed('minDepositAmount', state.minDepositAmount)
  }

  // TOKEN base units, despite the field naming the unit the withdraw endpoint
  // takes. The two scales differ on the SOL vault (9 vs 6), so reading it
  // wrong is silent there and a ~930× error — see `models.ts`.
  const publishedMinWithdraw = kaminoTokenAmountFromBaseUnitString(state.minWithdrawAmount, descriptor.tokenDecimals)
  if (!publishedMinWithdraw) throw malformed('minWithdrawAmount', state.minWithdrawAmount)

  const apy30d = parseKaminoDisplayDecimal(metrics.apy30d)
  if (apy30d === undefined) throw malformed('apy30d', metrics.apy30d)
  const tokenPriceUsd = parseKaminoDisplayDecimal(metrics.tokenPrice)
  if (tokenPriceUsd === undefined) throw malformed('tokenPrice', metrics.tokenPrice)

  // Parsed exactly rather than as a display decimal: this rate converts a
  // user's token amount into the shares a withdraw burns.
  const tokensPerShare = parseKaminoRate(metrics.tokensPerShare)
  if (!tokensPerShare || !isPositiveKaminoRate(tokensPerShare)) {
    throw malformed('tokensPerShare', metrics.tokensPerShare)
  }

  // The program's own withdraw floor is higher than the published figure, so
  // the form minimum is a multiple of it, converted to the share count a
  // withdraw has to name — rounded up, because a share count worth
  // fractionally less than the minimum is exactly the failure being avoided.
  const minWithdraw = kaminoTokenToShareAmountRoundedUp({
    tokens: kaminoTokenAmount(publishedMinWithdraw.baseUnits * minimumWithdrawMultiple, publishedMinWithdraw.decimals),
    tokensPerShare,
    shareDecimals: descriptor.sharesDecimals,
  })
  if (!minWithdraw || !isValidKaminoRequestAmount(publishedMinWithdraw) || !isValidKaminoRequestAmount(minWithdraw)) {
    throw malformed('minWithdrawAmount', state.minWithdrawAmount)
  }

  return {
    descriptor,
    name: state.name,
    minDeposit,
    minWithdraw,
    lookupTable: state.vaultLookupTable,
    apy30d,
    tokensPerShare,
    tokenPriceUsd,
    // Advisory, so an unreadable value drops the liquidity notice rather than
    // failing the whole hydration and blocking deposits too.
    tokensAvailable: kaminoTokenAmountFromDecimalString(metrics.tokensAvailable, descriptor.tokenDecimals),
  }
}
