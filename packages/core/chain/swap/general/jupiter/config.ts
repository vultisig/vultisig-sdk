export type JupiterConfig = {
  baseUrl: string
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

export const configureJupiter = (config: Partial<JupiterConfig>) => {
  jupiterConfig = {
    ...jupiterConfig,
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
  }
}

export const getJupiterConfig = (): JupiterConfig => {
  const baseUrl = readEnv('JUPITER_BASE_URL') ?? readEnv('VULTISIG_JUPITER_BASE_URL') ?? jupiterConfig.baseUrl

  return {
    ...jupiterConfig,
    baseUrl: baseUrl.replace(/\/$/, ''),
  }
}
