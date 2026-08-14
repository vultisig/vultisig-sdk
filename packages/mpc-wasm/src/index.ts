/**
 * @vultisig/mpc-wasm
 *
 * WASM-based MPC engine implementation.
 * Wraps the existing wasm-bindgen JS wrappers (vs_wasm.js, vs_schnorr_wasm.js).
 * Used by browser, Node.js, Electron, and Chrome Extension platforms.
 */
import initDkls, {
  KeygenSession as DklsKeygenSession,
  KeyImportInitiator as DklsKeyImportInitiator,
  KeyImportSession as DklsKeyImportSession,
  Keyshare as DklsKeyshare,
  QcSession as DklsQcSession,
  SignSession as DklsSignSession,
} from '@vultisig/lib-dkls/vs_wasm'
import initSchnorr, {
  KeygenSession as SchnorrKeygenSession,
  KeyImportInitiator as SchnorrKeyImportInitiator,
  KeyImportSession as SchnorrKeyImportSession,
  Keyshare as SchnorrKeyshare,
  QcSession as SchnorrQcSession,
  SignSession as SchnorrSignSession,
} from '@vultisig/lib-schnorr/vs_schnorr_wasm'
import {
  type DklsEngine,
  type MpcEngine,
  type MpcKeyshare,
  type MpcMessage,
  type MpcSession,
  type SchnorrEngine,
  WASM_MPC_ENGINE_KIND,
} from '@vultisig/mpc-types'

// ---------------------------------------------------------------------------
// Keyshare adapter
// ---------------------------------------------------------------------------

function wrapKeyshare(ks: DklsKeyshare | SchnorrKeyshare): MpcKeyshare {
  return {
    publicKey: () => ks.publicKey(),
    keyId: () => ks.keyId(),
    toBytes: () => ks.toBytes(),
    rootChainCode: () => ks.rootChainCode(),
    free: () => ks.free(),
  }
}

// ---------------------------------------------------------------------------
// Session adapter — wraps any WASM session into MpcSession
// ---------------------------------------------------------------------------

/** A WASM session object that follows the message-loop pattern. */
type WasmSessionLike = {
  outputMessage(): { body: Uint8Array; receivers: string[] } | undefined
  inputMessage(msg: Uint8Array): boolean
  free?(): void
}

function wrapSession<TWasm extends WasmSessionLike, TResult>(
  session: TWasm,
  finishFn: (s: TWasm) => TResult
): MpcSession<TResult> {
  return {
    outputMessage(): MpcMessage | undefined {
      const msg = session.outputMessage()
      if (!msg) return undefined
      return { body: msg.body, receivers: msg.receivers }
    },
    inputMessage(msg: Uint8Array): boolean {
      return session.inputMessage(msg)
    },
    finish(): TResult {
      return finishFn(session)
    },
    free() {
      session.free?.()
    },
  }
}

/**
 * Preserve the canonical Ed25519 R || S bytes emitted by the current WASM
 * binding. Both the WASM and native engines must expose the same wire format
 * so `core/mpc/keysign/index.ts` can remain backend-agnostic.
 *
 * Older bindings were believed to emit each half in big-endian order, which
 * led to a compensating reversal here. A real keygen/sign/verify ceremony
 * proved the current binding already emits canonical bytes; reversing them
 * produces an invalid signature. Keep this adapter as the explicit contract
 * boundary and return a fresh array without changing byte order.
 */
export function _normalizeSchnorrSig(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) {
    // Signature lengths other than 64 are unexpected for Ed25519. Pass the
    // bytes through unchanged so callers see the raw output and can fail
    // loudly downstream rather than us silently corrupting the payload.
    return sig
  }
  return new Uint8Array(sig)
}

// ---------------------------------------------------------------------------
// DKLS Engine
// ---------------------------------------------------------------------------

class WasmDklsEngine implements DklsEngine {
  keygenSetup(keyId: Uint8Array | null | undefined, threshold: number, partyIds: string[]): Uint8Array {
    return DklsKeygenSession.setup(keyId, threshold, partyIds)
  }

  createKeygenSession(setup: Uint8Array, localPartyId: string): MpcSession<MpcKeyshare> {
    const session = new DklsKeygenSession(setup, localPartyId)
    return wrapSession(session, s => wrapKeyshare(s.finish()))
  }

  createRefreshSession(setup: Uint8Array, localPartyId: string, oldKeyshare: MpcKeyshare): MpcSession<MpcKeyshare> {
    // Roundtrip serialization is required because MpcKeyshare is an opaque wrapper
    // that does not expose the underlying WASM Keyshare handle. Deserializing from
    // bytes also validates the keyshare and ensures it is in canonical form before
    // passing it to the native WASM session constructor.
    const rawKs = DklsKeyshare.fromBytes(oldKeyshare.toBytes())
    const session = DklsKeygenSession.refresh(setup, localPartyId, rawKs)
    return wrapSession(session, s => wrapKeyshare(s.finish()))
  }

  createMigrateSession(setup: Uint8Array, localPartyId: string, localUI: Uint8Array, publicKey: Uint8Array, rootChainCode: Uint8Array): MpcSession<MpcKeyshare> {
    const session = DklsKeygenSession.migrate(setup, localPartyId, localUI, publicKey, rootChainCode)
    return wrapSession(session, s => wrapKeyshare(s.finish()))
  }

  signSetup(keyId: Uint8Array, chainPath: string, messageHash: Uint8Array | null | undefined, partyIds: string[]): Uint8Array {
    return DklsSignSession.setup(keyId, chainPath, messageHash, partyIds)
  }

  signSetupMessageHash(setupMsg: Uint8Array): Uint8Array | undefined {
    return DklsSignSession.setupMessageHash(setupMsg)
  }

  signSetupKeyId(setupMsg: Uint8Array): Uint8Array | undefined {
    return DklsSignSession.setupKeyId(setupMsg)
  }

  createSignSession(setup: Uint8Array, localPartyId: string, keyshare: MpcKeyshare): MpcSession<Uint8Array> {
    // Roundtrip serialization is required because MpcKeyshare is an opaque wrapper
    // that does not expose the underlying WASM Keyshare handle. Deserializing from
    // bytes also validates the keyshare and ensures it is in canonical form before
    // passing it to the native WASM session constructor.
    const rawKs = DklsKeyshare.fromBytes(keyshare.toBytes())
    const session = new DklsSignSession(setup, localPartyId, rawKs)
    return wrapSession(session, s => s.finish())
  }

  keyshareFromBytes(bytes: Uint8Array): MpcKeyshare {
    return wrapKeyshare(DklsKeyshare.fromBytes(bytes))
  }

  reshareSetup(keyshare: MpcKeyshare, allPartyIds: string[], oldIndices: Uint8Array, threshold: number, newIndices: Uint8Array): Uint8Array {
    const rawKs = DklsKeyshare.fromBytes(keyshare.toBytes())
    return DklsQcSession.setup(rawKs, allPartyIds, oldIndices, threshold, newIndices)
  }

  createReshareSession(setup: Uint8Array, localPartyId: string, keyshare: MpcKeyshare | null): MpcSession<MpcKeyshare | undefined> {
    const rawKs = keyshare ? DklsKeyshare.fromBytes(keyshare.toBytes()) : null
    const session = new DklsQcSession(setup, localPartyId, rawKs)
    return wrapSession(session, s => {
      const result = s.finish()
      return result ? wrapKeyshare(result) : undefined
    })
  }

  createKeyImportInitiator(privateKey: Uint8Array, rootChainCode: Uint8Array | null | undefined, threshold: number, partyIds: string[]): { session: MpcSession<MpcKeyshare>; setup: Uint8Array } {
    const initiator = new DklsKeyImportInitiator(privateKey, rootChainCode, threshold, partyIds)
    const setup = initiator.setup
    return {
      session: wrapSession(initiator, s => wrapKeyshare(s.finish())),
      setup,
    }
  }

  createKeyImportSession(setup: Uint8Array, localPartyId: string): MpcSession<MpcKeyshare> {
    const session = new DklsKeyImportSession(setup, localPartyId)
    return wrapSession(session, s => wrapKeyshare(s.finish()))
  }
}

// ---------------------------------------------------------------------------
// Schnorr Engine
// ---------------------------------------------------------------------------

class WasmSchnorrEngine implements SchnorrEngine {
  keygenSetup(keyId: Uint8Array | null | undefined, threshold: number, partyIds: string[]): Uint8Array {
    return SchnorrKeygenSession.setup(keyId, threshold, partyIds)
  }

  createKeygenSession(setup: Uint8Array, localPartyId: string): MpcSession<MpcKeyshare> {
    const session = new SchnorrKeygenSession(setup, localPartyId)
    return wrapSession(session, s => wrapKeyshare(s.finish()))
  }

  createMigrateSession(setup: Uint8Array, localPartyId: string, localUI: Uint8Array, publicKey: Uint8Array, rootChainCode: Uint8Array): MpcSession<MpcKeyshare> {
    const session = SchnorrKeygenSession.migrate(setup, localPartyId, localUI, publicKey, rootChainCode)
    return wrapSession(session, s => wrapKeyshare(s.finish()))
  }

  signSetup(keyId: Uint8Array, chainPath: string, messageHash: Uint8Array | null | undefined, partyIds: string[]): Uint8Array {
    if (!messageHash) {
      throw new Error('Schnorr (EdDSA) signing requires a message hash')
    }
    return SchnorrSignSession.setup(keyId, chainPath, messageHash, partyIds)
  }

  signSetupMessageHash(setupMsg: Uint8Array): Uint8Array | undefined {
    return SchnorrSignSession.setupMessageHash(setupMsg)
  }

  signSetupKeyId(setupMsg: Uint8Array): Uint8Array | undefined {
    return SchnorrSignSession.setupKeyId(setupMsg)
  }

  createSignSession(setup: Uint8Array, localPartyId: string, keyshare: MpcKeyshare): MpcSession<Uint8Array> {
    // Re-create from bytes: MpcKeyshare doesn't expose the raw WASM Keyshare
    const rawKs = SchnorrKeyshare.fromBytes(keyshare.toBytes())
    const session = new SchnorrSignSession(setup, localPartyId, rawKs)
    // Keep the engine boundary explicit: the current WASM binding already
    // emits canonical Ed25519 R || S bytes, just like the native engine.
    return wrapSession(session, s => _normalizeSchnorrSig(s.finish()))
  }

  keyshareFromBytes(bytes: Uint8Array): MpcKeyshare {
    return wrapKeyshare(SchnorrKeyshare.fromBytes(bytes))
  }

  reshareSetup(keyshare: MpcKeyshare, allPartyIds: string[], oldIndices: Uint8Array, threshold: number, newIndices: Uint8Array): Uint8Array {
    const rawKs = SchnorrKeyshare.fromBytes(keyshare.toBytes())
    return SchnorrQcSession.setup(rawKs, allPartyIds, oldIndices, threshold, newIndices)
  }

  createReshareSession(setup: Uint8Array, localPartyId: string, keyshare: MpcKeyshare | null): MpcSession<MpcKeyshare | undefined> {
    const rawKs = keyshare ? SchnorrKeyshare.fromBytes(keyshare.toBytes()) : null
    const session = new SchnorrQcSession(setup, localPartyId, rawKs)
    return wrapSession(session, s => {
      const result = s.finish()
      return result ? wrapKeyshare(result) : undefined
    })
  }

  createKeyImportInitiator(privateKey: Uint8Array, rootChainCode: Uint8Array | null | undefined, threshold: number, partyIds: string[]): { session: MpcSession<MpcKeyshare>; setup: Uint8Array } {
    const initiator = new SchnorrKeyImportInitiator(privateKey, rootChainCode, threshold, partyIds)
    const setup = initiator.setup
    return {
      session: wrapSession(initiator, s => wrapKeyshare(s.finish())),
      setup,
    }
  }

  createKeyImportSession(setup: Uint8Array, localPartyId: string): MpcSession<MpcKeyshare> {
    const session = new SchnorrKeyImportSession(setup, localPartyId)
    return wrapSession(session, s => wrapKeyshare(s.finish()))
  }
}

// ---------------------------------------------------------------------------
// MpcEngine
// ---------------------------------------------------------------------------

export class WasmMpcEngine implements MpcEngine {
  readonly _mpcEngineKind = WASM_MPC_ENGINE_KIND

  readonly dkls: DklsEngine = new WasmDklsEngine()
  readonly schnorr: SchnorrEngine = new WasmSchnorrEngine()

  async initialize(): Promise<void> {
    await Promise.all([initDkls(), initSchnorr()])
  }
}
