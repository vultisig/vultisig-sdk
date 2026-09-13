import { kaminoConfig } from './config'

/**
 * Relative risk of a launch vault, used to order and label them.
 *
 * This is curation, not API data — Kamino exposes no risk or curator field
 * anywhere, so both live here and travel with the allow-list.
 *
 * `conservative` is plain over-collateralised lending against liquid crypto
 * collateral. `privateCredit` lends against tokenized private credit —
 * reinsurance, receivables and corporate bonds — which is materially different
 * risk and must not be presented as government-backed.
 */
export const kaminoRiskTiers = ['conservative', 'privateCredit'] as const

/** One of the curated risk-tier labels a launch vault is shown under. */
export type KaminoRiskTier = (typeof kaminoRiskTiers)[number]

/**
 * A curated vault the app offers.
 *
 * This carries everything a transaction is checked against, because a value
 * fetched from the API cannot be used to validate a transaction built by the
 * same API — the check would be circular, and a compromised response could
 * supply a matching pair. The fields below are all immutable properties of the
 * vault: a kVault's mints, their decimals and its farm are fixed at creation.
 * Everything that legitimately moves — name, minimums, APY, rates, the lookup
 * table — stays live, and the vault-info hydration refuses a response that
 * disagrees with the pinned identity.
 */
export type KaminoVaultDescriptor = {
  address: string
  /**
   * The vault's underlying token mint. Pinned: the deposit source and the
   * withdraw destination are derived from it.
   */
  tokenMint: string
  /**
   * Pinned because it scales every amount. A wrong scale mis-sizes the
   * transfer by a power of ten while every other check still passes.
   */
  tokenDecimals: number
  sharesMint: string
  sharesDecimals: number
  /**
   * The farm a deposit stakes into, or `undefined` when the vault has none.
   * Pinned because `farms::stake` moves the whole share balance into it.
   */
  farm?: string
  /** Shown until live state arrives, and as the fallback if it never does. */
  fallbackName: string
  curator: string
  riskTier: KaminoRiskTier
}

/**
 * The curated set of Kamino Earn vaults the app exposes.
 *
 * Kamino runs 160+ vaults; `GET /kvaults/vaults` returns all of them as a
 * single ~340 KB payload. The allow-list both curates and keeps the fetch
 * small — the three entries are hydrated with three ~2.8 KB per-vault requests
 * instead.
 *
 * The share scale is independent of the token scale — 6 against 9 on the SOL
 * vault — so nothing may assume the two match.
 */
export const kaminoVaultRegistry: readonly KaminoVaultDescriptor[] = [
  {
    address: 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E',
    tokenMint: kaminoConfig.usdcMint,
    tokenDecimals: 6,
    sharesMint: '7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS',
    sharesDecimals: 6,
    farm: '9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRZj',
    fallbackName: 'Steakhouse USDC',
    curator: 'Steakhouse Financial',
    riskTier: 'conservative',
  },
  {
    address: 'DWSXb18xZApz29vnQpgR2m6MynCT7PznaXt7Ut7M7KaP',
    tokenMint: kaminoConfig.usdcMint,
    tokenDecimals: 6,
    sharesMint: 'DgHN3q3dSYAchNX7V3D4aYiTWMx8RHTgHbfPiwiqBkE9',
    sharesDecimals: 6,
    farm: 'ArwyAHmnFmbKbUxC2fnK5VUEpspHrnoFtJ22bvEyriKk',
    fallbackName: 'RWA USDC',
    curator: 'RockawayX',
    riskTier: 'privateCredit',
  },
  {
    address: 'A1so1bPD3W1TfeFwboDh8yfAAVaVtcdAYBYCjhg2mJQ',
    tokenMint: kaminoConfig.wrappedSolMint,
    tokenDecimals: 9,
    sharesMint: 'FiM4VQdXXnTXL7GgChryf9zHNG9cmvKECwf34L2y3CkN',
    sharesDecimals: 6,
    farm: 'H6kauPaHmNqpdKtD5U2zw3Eb28ZB7iMeBdHVfLq1i4Kh',
    fallbackName: 'Allez SOL',
    curator: 'Allez Labs',
    riskTier: 'conservative',
  },
]

/**
 * Resolves the curated entry for a vault address, or `undefined` for any
 * address the registry does not carry. The returned descriptor is the app's
 * record of the vault's identity — always resolve through here rather than
 * accepting descriptor-shaped data from elsewhere.
 */
export const getKaminoVaultDescriptor = (address: string): KaminoVaultDescriptor | undefined =>
  kaminoVaultRegistry.find(vault => vault.address === address)
