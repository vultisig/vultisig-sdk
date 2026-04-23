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
 * Validate a user-supplied URL — must parse, must be http(s), must not be
 * empty. `fastVaultSign` POSTs the unlocked vault password to
 * `${vultiServerUrl}/sign`, so silently accepting `''` or an attacker-
 * controlled scheme would exfiltrate the password on first use. Fail at
 * config time so the bug surfaces at app boot, not during signing.
 */
function assertHttpUrl(field: 'vultiServerUrl' | 'relayUrl', value: string): void {
  if (value.length === 0) {
    throw new Error(`configureRuntime: ${field} must not be empty`)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`configureRuntime: ${field}=${JSON.stringify(value)} is not a valid URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`configureRuntime: ${field} must be http(s), got ${parsed.protocol}`)
  }
}

/**
 * Register consumer-injected runtime config. Safe to call multiple times
 * (later calls override earlier). Undefined fields do not clear prior values.
 *
 * Throws if `vultiServerUrl` or `relayUrl` is present but not a valid
 * http(s) URL — a bad value here is a fund-safety issue (see `assertHttpUrl`).
 */
export function configureRuntime(config: RuntimeConfig): void {
  if (config.vultiServerUrl !== undefined) assertHttpUrl('vultiServerUrl', config.vultiServerUrl)
  if (config.relayUrl !== undefined) assertHttpUrl('relayUrl', config.relayUrl)
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
