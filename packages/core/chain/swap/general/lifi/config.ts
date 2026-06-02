import { createConfig } from '@lifi/sdk'

/**
 * SDK-default LI.FI integrator + (optional) API URL. Used when no consumer
 * has called `setupLifi` with a custom config — affiliate fees on routes
 * fetched with these defaults land in the `vultisig-0` portal bucket.
 *
 * Consumers (e.g. Station via vultisig/mcp-ts) override at module boot
 * via `setupLifi({integratorName, apiUrl})` to redirect both the global
 * LI.FI SDK init AND the per-call integrator tag.
 */
export const lifiConfig = {
  integratorName: 'vultisig-0',
  apiUrl: undefined as string | undefined,
}

/**
 * Per-CALL affiliate config for LI.FI. Consumer-supplied via
 * `SwapAffiliateConfig.lifi`. Overrides the `integrator` tag on a single
 * `getQuote` request so affiliate fees route to the consumer's LI.FI portal
 * integrator instead of the SDK-default `vultisig-0`.
 *
 * NOTE: this type is INTENTIONALLY narrower than `LifiBootstrapConfig`.
 * LI.FI's `getQuote` API does not accept a per-call `apiUrl` — the base URL
 * is a property of the global SDK init. Including `apiUrl` here would
 * silently mislead consumers who supply `lifi: { integratorName, apiUrl }`
 * via `SwapAffiliateConfig` and expect the proxy to apply: it would not.
 * For the proxy URL, consumers must call `setupLifi({integratorName, apiUrl})`
 * at module boot — see `LifiBootstrapConfig`. (Ehsan-saradar #618 review.)
 */
export type LifiAffiliateConfig = {
  integratorName: string
}

/**
 * Global LI.FI SDK bootstrap config. Strictly wider than `LifiAffiliateConfig`
 * because `apiUrl` is meaningful here (passed to `@lifi/sdk`'s `createConfig`
 * as the base URL for every request the LI.FI SDK makes after this point) and
 * intentionally meaningless on the per-call surface.
 *
 * Consumers call `setupLifi(bootstrap)` once at module boot.
 */
export type LifiBootstrapConfig = {
  integratorName: string
  apiUrl?: string
}

let configured = false

/**
 * Initialise the global LI.FI SDK config.
 *
 * Two call modes:
 *
 * 1. **Consumer bootstrap** (`setupLifi(config)` with a config arg):
 *    Always applies — re-invokes `createConfig` with the supplied
 *    integrator + apiUrl regardless of whether a prior lazy default-fallback
 *    already ran. This protects against an "ordering footgun" where a swap
 *    quote runs before the consumer's boot-time setup and the lazy path
 *    silently latches the `vultisig-0` default + drops the consumer's
 *    later apiUrl proxy. (Ehsan-saradar #618 review.)
 *
 * 2. **Lazy default** (`setupLifi()` with no arg, called from
 *    `ensureLifiConfigured` in `getLifiSwapQuote`): only runs once; idempotent
 *    no-op on every subsequent call. Falls back to whatever `lifiConfig`
 *    currently holds — `vultisig-0` + no apiUrl unless a consumer mutated
 *    them already.
 *
 * Net effect:
 * - Consumer-before-lazy: consumer wins (the only `createConfig` call).
 * - Lazy-before-consumer: lazy installs defaults, then the consumer's
 *   explicit call overwrites them via the explicit-bootstrap branch above.
 * - Consumer-after-consumer: the latest consumer-bootstrap call overwrites
 *   `lifiConfig` and re-runs `createConfig` (last-writer wins). In practice
 *   consumers should only call this once. The `getLifiSwapQuote.integrator`
 *   test `'repeated calls re-run createConfig with each new config'` pins
 *   this contract. (Ehsan-saradar #618 r2.)
 */
export const setupLifi = (config?: LifiBootstrapConfig): void => {
  // Consumer-bootstrap branch — always applies, regardless of `configured`.
  if (config) {
    lifiConfig.integratorName = config.integratorName
    lifiConfig.apiUrl = config.apiUrl
    createConfig(
      config.apiUrl
        ? { integrator: config.integratorName, apiUrl: config.apiUrl }
        : { integrator: config.integratorName }
    )
    configured = true
    return
  }
  // Lazy default branch — idempotent.
  if (configured) return
  const integrator = lifiConfig.integratorName
  const apiUrl = lifiConfig.apiUrl
  createConfig(apiUrl ? { integrator, apiUrl } : { integrator })
  configured = true
}

/** @internal Test-only reset hook. Never call from production code. */
export const _resetLifiConfigForTest = (): void => {
  configured = false
  lifiConfig.integratorName = 'vultisig-0'
  lifiConfig.apiUrl = undefined
}
