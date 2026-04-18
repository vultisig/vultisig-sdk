/**
 * MPC engine runtime — configure and retrieve the active MPC engine.
 *
 * Each platform entry point calls {@link configureMpc} on module load.
 * SDK core code calls {@link getMpcEngine} to access the engine.
 */
import type { MpcEngine } from './index'

import { runtimeStore } from './store'

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
  const s = runtimeStore()
  if (s.mpcEngine !== null) {
    console.warn(
      'configureMpc: overwriting an already-configured MPC engine. ' +
        'This is usually a mistake — ensure configureMpc is called only once per process.'
    )
  }
  s.mpcEngine = engine
}

/**
 * Get the active MPC engine.
 *
 * @returns The configured {@link MpcEngine} instance.
 * @throws Error if no engine has been configured via {@link configureMpc}.
 */
export function getMpcEngine(): MpcEngine {
  const mpcEngine = runtimeStore().mpcEngine as MpcEngine | null
  if (!mpcEngine) {
    throw new Error(
      'MPC engine not configured. Import from a platform entry point ' +
        '(@vultisig/sdk, @vultisig/sdk/browser, @vultisig/sdk/react-native).'
    )
  }
  return mpcEngine
}

/**
 * Returns the configured engine, or lazily installs {@link WasmMpcEngine} from
 * `@vultisig/mpc-wasm` when none is set (browser/Node/Electron consumers).
 */
export async function ensureMpcEngine(): Promise<MpcEngine> {
  const s = runtimeStore()
  if (s.mpcEngine) {
    return s.mpcEngine as MpcEngine
  }
  let mod: { WasmMpcEngine: new () => MpcEngine }
  try {
    mod = await import('@vultisig/mpc-wasm')
  } catch (cause) {
    throw new Error(
      'MPC engine not configured and @vultisig/mpc-wasm is not installed. ' +
        'Either install @vultisig/mpc-wasm, or call configureMpc(...) before any MPC operation. ' +
        'See https://github.com/vultisig/vultisig-sdk/issues/287.',
      { cause: cause as Error }
    )
  }
  configureMpc(new mod.WasmMpcEngine())
  return runtimeStore().mpcEngine as MpcEngine
}
