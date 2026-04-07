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
