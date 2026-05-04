/**
 * MPC engine runtime — configure and retrieve the active MPC engine.
 *
 * Each platform entry point calls {@link configureMpc} on module load.
 * SDK core code calls {@link getMpcEngine} to access the engine.
 */
import type { MpcEngine } from './index'
import { runtimeStore } from './store'

const MPC_ENGINE_INSTANCE_ID = Symbol.for('vultisig.mpcEngine.instanceId')

/**
 * Tag on the default WASM MPC engine (`@vultisig/mpc-wasm`) so `configureMpc` can treat a
 * second instance as a benign duplicate when bundlers load the platform entry in multiple chunks.
 */
export const WASM_MPC_ENGINE_KIND = 'vultisigWasmMpcEngine' as const

const MPC_SINGLETON_POSTMORTEM =
  'https://github.com/vultisig/vultisig-windows/issues/3777 (MPC runtime singleton / duplicate engine)'

function randomInstanceId(): string {
  try {
    const c = globalThis.crypto
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID()
    }
  } catch {
    // ignore
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function ensureEngineInstanceId(engine: object): string {
  const bag = engine as Record<PropertyKey, unknown>
  const existing = bag[MPC_ENGINE_INSTANCE_ID]
  if (typeof existing === 'string') {
    return existing
  }
  const id = randomInstanceId()
  Object.defineProperty(bag, MPC_ENGINE_INSTANCE_ID, {
    value: id,
    enumerable: false,
    configurable: true,
    writable: false,
  })
  return id
}

function engineConstructorName(engine: object): string {
  const ctor = (engine as { constructor?: { name?: string } }).constructor
  const name = ctor?.name
  return typeof name === 'string' && name.length > 0 ? name : 'Object'
}

function isTaggedWasmMpcEngine(engine: object): boolean {
  try {
    return (
      (engine as { _mpcEngineKind?: string })._mpcEngineKind === WASM_MPC_ENGINE_KIND
    )
  } catch {
    return false
  }
}

function duplicateConfigureOriginHint(): string {
  const stack = new Error().stack?.split('\n') ?? []
  const hit = stack
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ') && !l.includes('runtime.ts'))
  return hit?.replace(/^at /, '') ?? '(configure origin unavailable)'
}

/**
 * Default: strict. Only go silent on an explicit production build, or when
 * VULTISIG_STRICT_SINGLETON=0 is set. The previous implementation defaulted to
 * silent whenever `process` was undefined, which hid duplicates in plain-ESM
 * browser bundles (exactly where the original bug surfaced).
 *
 * `EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON` is honoured as a fallback so Expo /
 * React Native consumers can disable the dev throw without a custom Babel
 * transform (Expo only inlines `EXPO_PUBLIC_*` env vars into the JS bundle).
 * `VULTISIG_STRICT_SINGLETON` still wins when both are set.
 */
function shouldThrowOnDuplicateMpcConfigure(): boolean {
  let strict: string | undefined
  let nodeEnv: string | undefined
  try {
    if (typeof process !== 'undefined' && process.env) {
      strict = process.env.VULTISIG_STRICT_SINGLETON ?? process.env.EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON
      nodeEnv = process.env.NODE_ENV
    }
  } catch {
    // Accessing process.env can throw in sandboxed runtimes — fall through to defaults.
  }
  if (strict === '0') {
    return false
  }
  if (strict === '1') {
    return true
  }
  return nodeEnv !== 'production'
}

/** `VULTISIG_STRICT_SINGLETON=1` / Expo alias — not the default dev NODE_ENV strictness. */
function isExplicitStrictSingletonDuplicateMode(): boolean {
  try {
    if (typeof process !== 'undefined' && process.env) {
      const strict =
        process.env.VULTISIG_STRICT_SINGLETON ?? process.env.EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON
      return strict === '1'
    }
  } catch {
    // ignore
  }
  return false
}

function reportDuplicateMpcEngine(existing: object, incoming: MpcEngine): void {
  const existingCtor = engineConstructorName(existing)
  const incomingCtor = engineConstructorName(incoming)
  const existingId = ensureEngineInstanceId(existing)
  const incomingId = ensureEngineInstanceId(incoming)
  const origin = duplicateConfigureOriginHint()
  const sameShape = existingCtor === incomingCtor && existingId !== incomingId
  const body =
    `configureMpc: refusing to silently replace an active MPC engine with a different instance.\n` +
    `  existing: constructor=${existingCtor} instanceId=${existingId}\n` +
    `  incoming: constructor=${incomingCtor} instanceId=${incomingId}\n` +
    `  sameConstructorDifferentInstance=${String(sameShape)}\n` +
    `  incoming call site (best effort): ${origin}\n` +
    `  See: ${MPC_SINGLETON_POSTMORTEM}`
  console.error(body)
}

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
  const prev = s.mpcEngine as MpcEngine | null
  if (prev === engine) {
    return
  }
  // Dual tagged WasmMpcEngine: keep the first registration when not in strict duplicate
  // mode. (Non-tagged duplicate engines below still follow the legacy rule: production
  // overwrites with the incoming engine.)
  if (
    prev !== null &&
    isTaggedWasmMpcEngine(prev as object) &&
    isTaggedWasmMpcEngine(engine as object)
  ) {
    if (isExplicitStrictSingletonDuplicateMode()) {
      reportDuplicateMpcEngine(prev as object, engine)
      throw new Error(
        'configureMpc: duplicate MPC engine instance. ' +
          `Unset process.env.VULTISIG_STRICT_SINGLETON=1 (or EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON=1 for Expo / React Native consumers) to allow duplicate WasmMpcEngine registrations to warn and keep the first engine. ${MPC_SINGLETON_POSTMORTEM}`
      )
    }
    // Two WasmMpcEngine instances (e.g. duplicate Vite/Rollup chunks each importing the
    // platform entry) are redundant — keep the first registered engine.
    console.warn(
      'configureMpc: ignoring duplicate WasmMpcEngine registration (bundler duplicate chunk / repeated platform init). ' +
        MPC_SINGLETON_POSTMORTEM
    )
    return
  }
  if (prev !== null) {
    reportDuplicateMpcEngine(prev as object, engine)
    if (shouldThrowOnDuplicateMpcConfigure()) {
      throw new Error(
        'configureMpc: duplicate MPC engine instance. ' +
          `Set process.env.VULTISIG_STRICT_SINGLETON=0 (or EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON=0 for Expo / React Native consumers) to allow overwrite when needed. ${MPC_SINGLETON_POSTMORTEM}`
      )
    }
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
    const error = new Error(
      'MPC engine not configured and @vultisig/mpc-wasm is not installed. ' +
        'Either install @vultisig/mpc-wasm, or call configureMpc(...) before any MPC operation. ' +
        'See https://github.com/vultisig/vultisig-sdk/issues/287.'
    )
    Object.assign(error, { cause })
    throw error
  }
  configureMpc(new mod.WasmMpcEngine())
  return runtimeStore().mpcEngine as MpcEngine
}
