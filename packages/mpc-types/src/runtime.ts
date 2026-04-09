/**
 * MPC engine runtime — configure and retrieve the active MPC engine.
 *
 * Each platform entry point calls {@link configureMpc} on module load.
 * SDK core code calls {@link getMpcEngine} to access the engine.
 */
import type { MpcEngine } from './index'

let mpcEngine: MpcEngine | null = null

/**
 * Validate that an engine object satisfies the minimum MpcEngine contract.
 * Throws a descriptive error if required properties are missing.
 */
function validateEngine(engine: MpcEngine): void {
  if (typeof engine.initialize !== 'function') {
    throw new Error('MPC engine is missing required method: initialize()')
  }
  if (!engine.dkls || typeof engine.dkls !== 'object') {
    throw new Error('MPC engine is missing required property: dkls')
  }
  if (!engine.schnorr || typeof engine.schnorr !== 'object') {
    throw new Error('MPC engine is missing required property: schnorr')
  }
  // Guard against engines that accidentally expose a `mldsa` field aliased to
  // the DKLS engine — that would silently route Dilithium operations through
  // ECDSA. MLDSA must use a dedicated signing path (packages/core/mpc/mldsa/).
  const maybeEngine = engine as unknown as Record<string, unknown>
  if ('mldsa' in maybeEngine) {
    if (maybeEngine['mldsa'] === engine.dkls) {
      throw new Error(
        'MPC engine: engine.mldsa must not alias engine.dkls. ' +
        'MLDSA requires a dedicated signing path, not ECDSA/DKLS.'
      )
    }
  }
}

/**
 * Register the MPC engine for this platform.
 * Called by platform entry points (browser, node, react-native).
 *
 * @param engine - The MPC engine implementation to use.
 * @throws Error if the engine does not satisfy the {@link MpcEngine} interface.
 */
export function configureMpc(engine: MpcEngine): void {
  validateEngine(engine)
  if (mpcEngine !== null) {
    console.warn(
      'configureMpc: overwriting an already-configured MPC engine. ' +
      'This is usually a mistake — ensure configureMpc is called only once per process.'
    )
  }
  mpcEngine = engine
}

/**
 * Get the active MPC engine.
 *
 * @returns The configured {@link MpcEngine} instance.
 * @throws Error if no engine has been configured via {@link configureMpc}.
 */
export function getMpcEngine(): MpcEngine {
  if (!mpcEngine) {
    throw new Error(
      'MPC engine not configured. Import from a platform entry point ' +
        '(@vultisig/sdk, @vultisig/sdk/browser, @vultisig/sdk/react-native).'
    )
  }
  return mpcEngine
}
