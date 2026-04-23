/**
 * RN runtime registry for consumer-injected API endpoints.
 *
 * The SDK's RN-only MPC helpers (fastVaultSign, relay orchestrators) need to
 * look up VultiServer / relay endpoints without hardcoding them. Consumers
 * call `configureRuntime()` once at app boot; helpers read lazily from this
 * registry.
 *
 * `vultiServerUrl` and `relayUrl` default to the SDK's built-in endpoints if
 * not overridden.
 */

export type RuntimeConfig = {
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
