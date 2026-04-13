/**
 * @vultisig/mpc-wasm
 *
 * WASM-based MPC engine implementation.
 * Wraps the existing wasm-bindgen JS wrappers (vs_wasm.js, vs_schnorr_wasm.js).
 * Used by browser, Node.js, Electron, and Chrome Extension platforms.
 */
import type {
  MpcEngine,
  DklsEngine,
  SchnorrEngine,
  MpcSession,
  MpcKeyshare,
  MpcMessage,
} from '@vultisig/mpc-types'

import initDkls, {
  KeygenSession as DklsKeygenSession,
  SignSession as DklsSignSession,
  Keyshare as DklsKeyshare,
  QcSession as DklsQcSession,
  KeyImportInitiator as DklsKeyImportInitiator,
  KeyImportSession as DklsKeyImportSession,
} from '@vultisig/lib-dkls/vs_wasm'

import initSchnorr, {
  KeygenSession as SchnorrKeygenSession,
  SignSession as SchnorrSignSession,
  Keyshare as SchnorrKeyshare,
  QcSession as SchnorrQcSession,
  KeyImportInitiator as SchnorrKeyImportInitiator,
  KeyImportSession as SchnorrKeyImportSession,
} from '@vultisig/lib-schnorr/vs_schnorr_wasm'

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
interface WasmSessionLike {
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
 * Normalize a 64-byte Schnorr (Ed25519) signature emitted by the WASM
 * `SchnorrSignSession.finish()` — which uses big-endian byte order for both
 * the R point and the S scalar — into canonical Ed25519 R || S
 * little-endian bytes that ed25519-dalek and downstream verifiers expect.
 *
 * Both the WASM engine and the native `@vultisig/mpc-native` engine MUST
 * emit the same canonical wire format from their `finish()` so that
 * `core/mpc/keysign/index.ts` can pass the bytes through without any
 * backend-specific byte-ordering logic.
 *
 * Exported (`_normalizeSchnorrSig`, underscore-prefixed = internal) for
 * unit testing — see vultisig/vultisig-sdk#252.
 *
 * Returns a fresh Uint8Array (does not mutate the input).
 */
export function _normalizeSchnorrSig(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) {
    // Signature lengths other than 64 are unexpected for Ed25519. Pass the
    // bytes through unchanged so callers see the raw output and can fail
    // loudly downstream rather than us silently corrupting the payload.
    return sig
  }
  const out = new Uint8Array(64)
  // Reverse R (first 32 bytes) into out[0..32]
  for (let i = 0; i < 32; i++) {
    out[i] = sig[31 - i]!
  }
  // Reverse S (next 32 bytes) into out[32..64]
  for (let i = 0; i < 32; i++) {
    out[32 + i] = sig[63 - i]!
  }
  return out
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
    // Normalize WASM SchnorrSignSession output to canonical Ed25519 R || S
    // little-endian bytes so consumers (e.g. core/mpc/keysign/index.ts) can
    // pass through without backend-specific byte-ordering logic. The raw
    // wasm-bindgen output is big-endian R || S, which is the historical
    // reason core/mpc/keysign was reversing both halves unconditionally for
    // EdDSA. That unconditional reverse corrupted the native MpcEngine
    // output (which is already canonical), so the reverse moved here:
    // each engine is responsible for emitting canonical bytes from its
    // own finish().
    //
    // See vultisig/vultisig-sdk#252 (this PR) for the original incident
    // and on-chain proof — Ed25519 R is a compressed Edwards point and
    // reversing it corrupts the point representation entirely.
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
  readonly dkls: DklsEngine = new WasmDklsEngine()
  readonly schnorr: SchnorrEngine = new WasmSchnorrEngine()

  async initialize(): Promise<void> {
    await Promise.all([initDkls(), initSchnorr()])
  }
}
