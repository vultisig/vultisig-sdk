/**
 * RN runtime registry for consumer-injected chain RPC URLs and API endpoints.
 *
 * The SDK's vendored RN chain bridges (cosmos/sui/utxo) and RN-only tx helpers
 * need to look up RPC URLs without pulling in chain-client SDKs (viem, cosmjs,
 * etc). Consumers call `configureRuntime()` once at app boot; bridges read
 * lazily from this registry.
 *
 * `vultiServerUrl` and `relayUrl` default to the SDK's built-in endpoints if
 * not overridden. `getRpcUrl` is required — there is no safe default for it,
 * since URL choice depends on the consumer's upstream deployment.
 */

import type { Chain } from '@vultisig/core-chain/Chain'

export type RuntimeConfig = {
  /**
   * Return the JSON-RPC endpoint for a given chain. Called lazily from tx
   * builders and balance fetchers — does not need to be synchronous-fast.
   */
  getRpcUrl?: (chain: Chain | string) => string
  /**
   * VultiServer (fast-vault API) endpoint. Optional — if omitted, bridges
   * call the SDK default passed through Vultisig/VaultManager classes.
   */
  vultiServerUrl?: string
  /**
   * Message relay endpoint. Optional — same fallback behavior as
   * vultiServerUrl.
   */
  relayUrl?: string
}

let state: RuntimeConfig = {}

/**
 * Register consumer-injected runtime config. Safe to call multiple times
 * (later calls override earlier). Undefined fields do not clear prior values.
 */
export function configureRuntime(config: RuntimeConfig): void {
  state = {
    ...state,
    ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)),
  }
}

/**
 * Get the registered `getRpcUrl` resolver, or throw if not configured.
 * Vendored RN bridges call this when they need to reach a chain endpoint.
 */
export function getConfiguredRpcUrl(chain: Chain | string): string {
  if (!state.getRpcUrl) {
    throw new Error(
      `@vultisig/sdk/react-native: configureRuntime({ getRpcUrl }) must be called at app boot before reaching ${String(chain)} tx builders`
    )
  }
  return state.getRpcUrl(chain)
}

/**
 * Get the registered vultiServer URL. Returns undefined if consumer did not
 * override; callers fall back to SDK default.
 */
export function getConfiguredVultiServerUrl(): string | undefined {
  return state.vultiServerUrl
}

/**
 * Get the registered relay URL. Returns undefined if consumer did not
 * override; callers fall back to SDK default.
 */
export function getConfiguredRelayUrl(): string | undefined {
  return state.relayUrl
}
