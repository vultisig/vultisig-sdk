export type JupiterConfig = {
  baseUrl: string
}

export type JupiterAffiliateConfig = {
  /**
   * Solana wallet that owns Jupiter affiliate fee token accounts.
   *
   * The per-swap `feeAccount` is derived as this owner's ATA for the quoted
   * output mint. Omit this config to use Vultisig's default fee owner.
   */
  feeOwner?: string
  /**
   * Optional per-call Jupiter proxy/API base URL. Blank values are ignored so
   * callers fall back to the configured default.
   */
  baseUrl?: string
}

/**
 * Vultisig-proxied Jupiter base URL. The proxy injects any required upstream
 * credentials server-side and shields the client from Jupiter rate limits, so
 * no client-side key is needed.
 *
 * Quote: `${baseUrl}/swap/v1/quote`
 * Swap:  `${baseUrl}/swap/v1/swap`
 *
 * Callers may override via `configureJupiter({ baseUrl })` or the
 * `JUPITER_BASE_URL` / `VULTISIG_JUPITER_BASE_URL` env vars.
 */
const defaultBaseUrl = 'https://api.vultisig.com/jup'

/**
 * Solana wallet that owns every Jupiter affiliate fee account. The per-swap
 * `feeAccount` is the Associated Token Account of `(owner = this wallet, mint =
 * output mint)`. Shared verbatim across SDK / iOS / Android so fees from all
 * platforms accrue to the same owner.
 */
export const jupiterFeeOwnerAddress = '8iqhrtBzMcYLR6c6FkzeoMHibedYDkHvLKnX2ArNie5z'

const readEnv = (key: string): string | undefined => {
  const maybeGlobal = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }

  return maybeGlobal.process?.env?.[key]
}

let jupiterConfig: JupiterConfig = {
  baseUrl: defaultBaseUrl,
}

/**
 * Trim an override and strip trailing slashes. Blank/whitespace-only values are
 * treated as absent (returns `undefined`) so they fall back to the default
 * rather than producing relative `/swap/v1/...` URLs downstream.
 */
export const normalizeJupiterBaseUrl = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim().replace(/\/+$/, '')
  return trimmed ? trimmed : undefined
}

export const configureJupiter = (config: Partial<JupiterConfig>) => {
  const baseUrl = normalizeJupiterBaseUrl(config.baseUrl)
  jupiterConfig = {
    ...jupiterConfig,
    ...(baseUrl ? { baseUrl } : {}),
  }
}

export const getJupiterConfig = (): JupiterConfig => {
  const baseUrl =
    normalizeJupiterBaseUrl(readEnv('JUPITER_BASE_URL')) ??
    normalizeJupiterBaseUrl(readEnv('VULTISIG_JUPITER_BASE_URL')) ??
    jupiterConfig.baseUrl

  return {
    ...jupiterConfig,
    baseUrl,
  }
}
