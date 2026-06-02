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
 * Per-aggregator affiliate config for LI.FI. Consumer-supplied via
 * `SwapAffiliateConfig.lifi`. Overrides the per-call `integrator` tag in
 * `getQuote` so affiliate fees route to the consumer's LI.FI portal
 * integrator instead of the SDK-default `vultisig-0`.
 *
 * `apiUrl` is honoured only when this config drives the global
 * `setupLifi(...)` call — LI.FI's `getQuote` does not accept a per-call
 * `apiUrl` override. Consumers that need a proxied base URL must call
 * `setupLifi({integratorName, apiUrl})` at module boot.
 */
export type LifiAffiliateConfig = {
  integratorName: string
  apiUrl?: string
}

let configured = false

/**
 * Initialise the global LI.FI SDK config. Consumers (e.g. Station's mcp-ts
 * deployment) call this once at module boot with their integrator + proxy
 * URL. Subsequent calls are no-ops — the first caller wins.
 *
 * When unset, `getLifiSwapQuote` lazy-inits with the `vultisig-0` default
 * via the same internal memoisation path.
 */
export const setupLifi = (config?: LifiAffiliateConfig): void => {
  if (configured) return
  const integrator = config?.integratorName ?? lifiConfig.integratorName
  const apiUrl = config?.apiUrl ?? lifiConfig.apiUrl
  if (config) {
    lifiConfig.integratorName = integrator
    lifiConfig.apiUrl = apiUrl
  }
  createConfig(apiUrl ? { integrator, apiUrl } : { integrator })
  configured = true
}

/** @internal Test-only reset hook. Never call from production code. */
export const _resetLifiConfigForTest = (): void => {
  configured = false
  lifiConfig.integratorName = 'vultisig-0'
  lifiConfig.apiUrl = undefined
}
