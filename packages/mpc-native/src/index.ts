/**
 * @vultisig/mpc-native
 *
 * Native MPC engine implementation for React Native / Expo.
 * Wraps the Go-based godkls and goschnorr native libraries via Expo modules.
 */
import type {
  MpcEngine,
  DklsEngine,
  SchnorrEngine,
  MpcSession,
  MpcKeyshare,
  MpcMessage,
} from '@vultisig/mpc-types'

import ExpoMpcNative from './ExpoMpcNativeModule'

// ---------------------------------------------------------------------------
// Helpers — base64 <-> Uint8Array
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  // React Native supports btoa but it requires a binary string
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// NativeKeyshare — wraps a native handle
// ---------------------------------------------------------------------------

type KeyshareKind = 'dkls' | 'schnorr'

class NativeKeyshare implements MpcKeyshare {
  constructor(
    public readonly handle: number,
    private _bytes: Uint8Array | null,
    readonly kind: KeyshareKind
  ) {}

  publicKey(): Uint8Array {
    const b64 =
      this.kind === 'dkls'
        ? ExpoMpcNative.dklsKeysharePublicKey(this.handle)
        : ExpoMpcNative.schnorrKeysharePublicKey(this.handle)
    return fromBase64(b64)
  }

  keyId(): Uint8Array {
    const b64 =
      this.kind === 'dkls'
        ? ExpoMpcNative.dklsKeyshareKeyId(this.handle)
        : ExpoMpcNative.schnorrKeyshareKeyId(this.handle)
    return fromBase64(b64)
  }

  toBytes(): Uint8Array {
    if (!this._bytes) {
      const b64 =
        this.kind === 'dkls'
          ? ExpoMpcNative.dklsKeyshareToBytes(this.handle)
          : ExpoMpcNative.schnorrKeyshareToBytes(this.handle)
      this._bytes = fromBase64(b64)
    }
    return this._bytes
  }

  rootChainCode(): Uint8Array {
    const b64 =
      this.kind === 'dkls'
        ? ExpoMpcNative.dklsKeyshareChainCode(this.handle)
        : ExpoMpcNative.schnorrKeyshareChainCode(this.handle)
    return fromBase64(b64)
  }

  free(): void {
    if (this.kind === 'dkls') {
      ExpoMpcNative.freeKeyshare(this.handle)
    } else {
      ExpoMpcNative.freeSchnorrKeyshare(this.handle)
    }
  }
}

// ---------------------------------------------------------------------------
// NativeSession — wraps keygen/sign/qc/import session handles
// ---------------------------------------------------------------------------

interface SessionOps<TResult> {
  outputMessage(handle: number): string | null
  messageReceiver(handle: number, msgBase64: string, index: number): string
  inputMessage(handle: number, msgBase64: string): boolean
  finish(handle: number): TResult | Promise<TResult>
  free(handle: number): void
}

class NativeSession<TResult> implements MpcSession<TResult> {
  constructor(
    private readonly handle: number,
    private readonly ops: SessionOps<TResult>
  ) {}

  outputMessage(): MpcMessage | undefined {
    const msgB64 = this.ops.outputMessage(this.handle)
    if (!msgB64) return undefined

    const body = fromBase64(msgB64)

    // Collect receivers — iterate indices until the native layer returns a
    // falsy sentinel (empty string or null/undefined). The native functions
    // return "" when the index is out of range, so we stop on that.
    const receivers: string[] = []
    for (let i = 0; ; i++) {
      const receiver = this.ops.messageReceiver(this.handle, msgB64, i)
      if (!receiver) break
      receivers.push(receiver)
    }

    return { body, receivers }
  }

  inputMessage(msg: Uint8Array): boolean {
    return this.ops.inputMessage(this.handle, toBase64(msg))
  }

  finish(): TResult | Promise<TResult> {
    return this.ops.finish(this.handle)
  }

  free(): void {
    this.ops.free(this.handle)
  }
}

// ---------------------------------------------------------------------------
// DKLS Engine
// ---------------------------------------------------------------------------

class NativeDklsEngine implements DklsEngine {
  keygenSetup(
    keyId: Uint8Array | null | undefined,
    threshold: number,
    partyIds: string[]
  ): Uint8Array {
    const keyIdB64 = keyId ? toBase64(keyId) : null
    const b64 = ExpoMpcNative.dklsKeygenSetup(threshold, keyIdB64, partyIds)
    return fromBase64(b64)
  }

  async createKeygenSession(
    setup: Uint8Array,
    localPartyId: string
  ): Promise<MpcSession<MpcKeyshare>> {
    const handle = await ExpoMpcNative.createKeygenSession(
      toBase64(setup),
      localPartyId
    )
    return new NativeSession<MpcKeyshare>(handle, {
      outputMessage: (h) => ExpoMpcNative.keygenSessionOutputMessage(h),
      messageReceiver: (h, m, i) =>
        ExpoMpcNative.keygenSessionMessageReceiver(h, m, i),
      inputMessage: (h, m) => ExpoMpcNative.keygenSessionInputMessage(h, m),
      finish: async (h) => {
        const result = await ExpoMpcNative.finishKeygen(h)
        // finishKeygen returns raw data (hex/base64), not a native handle.
        // Wrap in a MpcKeyshare-compatible object.
        const ksBytes = fromBase64(result.keyshare)
        const pkBytes = fromHex(result.publicKey)
        const ccBytes = fromHex(result.chainCode)
        return {
          publicKey: () => pkBytes,
          rootChainCode: () => ccBytes,
          toBytes: () => ksBytes,
          keyId: () => pkBytes,
          free: () => {},
        } as unknown as MpcKeyshare
      },
      free: (h) => ExpoMpcNative.freeKeygenSession(h),
    })
  }

  createRefreshSession(
    setup: Uint8Array,
    localPartyId: string,
    oldKeyshare: MpcKeyshare
  ): MpcSession<MpcKeyshare> {
    const nativeKs = this._ensureNativeKeyshare(oldKeyshare)
    const isTemporary = !(oldKeyshare instanceof NativeKeyshare && oldKeyshare.kind === 'dkls')
    const handle = ExpoMpcNative.createKeygenRefreshSession(
      toBase64(setup),
      localPartyId,
      nativeKs.handle
    )
    // Free temporary handle after Go has copied the data during session creation
    if (isTemporary) {
      nativeKs.free()
    }
    return this._makeKeygenSession(handle)
  }

  createMigrateSession(
    setup: Uint8Array,
    localPartyId: string,
    localUI: Uint8Array,
    publicKey: Uint8Array,
    rootChainCode: Uint8Array
  ): MpcSession<MpcKeyshare> {
    const handle = ExpoMpcNative.createKeygenMigrationSession(
      toBase64(setup),
      localPartyId,
      toBase64(publicKey),
      toBase64(rootChainCode),
      toBase64(localUI)
    )
    return this._makeKeygenSession(handle)
  }

  signSetup(
    keyId: Uint8Array,
    chainPath: string,
    messageHash: Uint8Array | null | undefined,
    partyIds: string[]
  ): Uint8Array {
    const b64 = ExpoMpcNative.dklsSignSetup(
      toBase64(keyId),
      chainPath,
      messageHash ? toBase64(messageHash) : null,
      partyIds
    )
    return fromBase64(b64)
  }

  signSetupMessageHash(setupMsg: Uint8Array): Uint8Array | undefined {
    const b64 = ExpoMpcNative.dklsDecodeMessage(toBase64(setupMsg))
    return b64 ? fromBase64(b64) : undefined
  }

  signSetupKeyId(setupMsg: Uint8Array): Uint8Array | undefined {
    const b64 = ExpoMpcNative.dklsDecodeKeyId(toBase64(setupMsg))
    return b64 ? fromBase64(b64) : undefined
  }

  createSignSession(
    setup: Uint8Array,
    localPartyId: string,
    keyshare: MpcKeyshare
  ): MpcSession<Uint8Array> {
    const nativeKs = this._ensureNativeKeyshare(keyshare)
    const isTemporary = !(keyshare instanceof NativeKeyshare && keyshare.kind === 'dkls')
    const handle = ExpoMpcNative.createSignSession(
      toBase64(setup),
      localPartyId,
      nativeKs.handle
    )
    // Free temporary handle after Go has copied the data during session creation
    if (isTemporary) {
      nativeKs.free()
    }
    return new NativeSession<Uint8Array>(handle, {
      outputMessage: (h) => ExpoMpcNative.signSessionOutputMessage(h),
      messageReceiver: (h, m, i) =>
        ExpoMpcNative.signSessionMessageReceiver(h, m, i),
      inputMessage: (h, m) => ExpoMpcNative.signSessionInputMessage(h, m),
      finish: (h) => fromBase64(ExpoMpcNative.finishSign(h)),
      free: (h) => ExpoMpcNative.freeSignSession(h),
    })
  }

  keyshareFromBytes(bytes: Uint8Array): MpcKeyshare {
    const handle = ExpoMpcNative.dklsKeyshareFromBytes(toBase64(bytes))
    return new NativeKeyshare(handle, bytes, 'dkls')
  }

  reshareSetup(
    keyshare: MpcKeyshare,
    allPartyIds: string[],
    oldIndices: Uint8Array,
    threshold: number,
    newIndices: Uint8Array
  ): Uint8Array {
    const nativeKs = this._ensureNativeKeyshare(keyshare)
    const isTemporary = !(keyshare instanceof NativeKeyshare && keyshare.kind === 'dkls')
    try {
      const b64 = ExpoMpcNative.dklsQcSetup(
        nativeKs.handle,
        allPartyIds,
        toBase64(oldIndices),
        threshold,
        toBase64(newIndices)
      )
      return fromBase64(b64)
    } finally {
      // Free the temporary handle if we created one via _ensureNativeKeyshare
      if (isTemporary) {
        nativeKs.free()
      }
    }
  }

  createReshareSession(
    setup: Uint8Array,
    localPartyId: string,
    keyshare: MpcKeyshare | null
  ): MpcSession<MpcKeyshare | undefined> {
    // If keyshare is not a native handle (e.g. it was deserialized from bytes),
    // _ensureNativeKeyshare creates a temporary native handle. We track whether
    // it was temporary so it can be freed after the session is created —
    // the session only needs the handle during setup, not for its lifetime.
    let tempKeyshare: NativeKeyshare | null = null
    let ksHandle: number | null = null
    if (keyshare) {
      const nativeKs = this._ensureNativeKeyshare(keyshare)
      const isTemporary = !(keyshare instanceof NativeKeyshare && keyshare.kind === 'dkls')
      ksHandle = nativeKs.handle
      if (isTemporary) {
        tempKeyshare = nativeKs
      }
    }

    let handle: number
    try {
      handle = ExpoMpcNative.createQcSession(toBase64(setup), localPartyId, ksHandle)
    } finally {
      // Free the temporary native keyshare now that the session has been created
      tempKeyshare?.free()
    }

    return new NativeSession<MpcKeyshare | undefined>(handle, {
      outputMessage: (h) => ExpoMpcNative.qcSessionOutputMessage(h),
      messageReceiver: (h, m, i) =>
        ExpoMpcNative.qcSessionMessageReceiver(h, m, i),
      inputMessage: (h, m) => ExpoMpcNative.qcSessionInputMessage(h, m),
      finish: (h) => {
        const resultHandle = ExpoMpcNative.finishQc(h)
        return resultHandle >= 0
          ? new NativeKeyshare(resultHandle, null, 'dkls')
          : undefined
      },
      free: (h) => ExpoMpcNative.freeQcSession(h),
    })
  }

  createKeyImportInitiator(
    privateKey: Uint8Array,
    rootChainCode: Uint8Array | null | undefined,
    threshold: number,
    partyIds: string[]
  ): { session: MpcSession<MpcKeyshare>; setup: Uint8Array } {
    const result = ExpoMpcNative.createDklsKeyImportInitiator(
      toHex(privateKey),
      rootChainCode ? toHex(rootChainCode) : null,
      threshold,
      partyIds
    )
    const session = this._makeKeygenSession(result.sessionHandle)
    return { session, setup: fromBase64(result.setupMessage) }
  }

  async createKeyImportSession(
    setup: Uint8Array,
    localPartyId: string
  ): Promise<MpcSession<MpcKeyshare>> {
    const handle = await ExpoMpcNative.createDklsKeyImportSession(
      toBase64(setup),
      localPartyId
    )
    return this._makeKeygenSession(handle)
  }

  // --- Private helpers ---

  private _ensureNativeKeyshare(ks: MpcKeyshare): NativeKeyshare {
    if (ks instanceof NativeKeyshare && ks.kind === 'dkls') {
      return ks
    }
    // Re-create from bytes
    const bytes = ks.toBytes()
    const handle = ExpoMpcNative.dklsKeyshareFromBytes(toBase64(bytes))
    return new NativeKeyshare(handle, bytes, 'dkls')
  }

  private _makeKeygenSession(handle: number): MpcSession<MpcKeyshare> {
    return new NativeSession<MpcKeyshare>(handle, {
      outputMessage: (h) => ExpoMpcNative.keygenSessionOutputMessage(h),
      messageReceiver: (h, m, i) =>
        ExpoMpcNative.keygenSessionMessageReceiver(h, m, i),
      inputMessage: (h, m) => ExpoMpcNative.keygenSessionInputMessage(h, m),
      finish: async (h) => {
        const result = await ExpoMpcNative.finishKeygen(h)
        const ksBytes = fromBase64(result.keyshare)
        const pkBytes = fromHex(result.publicKey)
        const ccBytes = fromHex(result.chainCode)
        return {
          publicKey: () => pkBytes,
          rootChainCode: () => ccBytes,
          toBytes: () => ksBytes,
          keyId: () => pkBytes,
          free: () => {},
        } as unknown as MpcKeyshare
      },
      free: (h) => ExpoMpcNative.freeKeygenSession(h),
    })
  }
}

// ---------------------------------------------------------------------------
// Schnorr Engine
// ---------------------------------------------------------------------------

class NativeSchnorrEngine implements SchnorrEngine {
  keygenSetup(
    keyId: Uint8Array | null | undefined,
    threshold: number,
    partyIds: string[]
  ): Uint8Array {
    const keyIdB64 = keyId ? toBase64(keyId) : null
    const b64 = ExpoMpcNative.schnorrKeygenSetup(threshold, keyIdB64, partyIds)
    return fromBase64(b64)
  }

  async createKeygenSession(
    setup: Uint8Array,
    localPartyId: string
  ): Promise<MpcSession<MpcKeyshare>> {
    const handle = await ExpoMpcNative.createSchnorrKeygenSession(
      toBase64(setup),
      localPartyId
    )
    return new NativeSession<MpcKeyshare>(handle, {
      outputMessage: (h) =>
        ExpoMpcNative.schnorrKeygenSessionOutputMessage(h),
      messageReceiver: (h, m, i) =>
        ExpoMpcNative.schnorrKeygenSessionMessageReceiver(h, m, i),
      inputMessage: (h, m) =>
        ExpoMpcNative.schnorrKeygenSessionInputMessage(h, m),
      finish: async (h) => {
        const result = await ExpoMpcNative.finishSchnorrKeygen(h)
        const ksBytes = fromBase64(result.keyshare)
        const pkBytes = fromHex(result.publicKey)
        const ccBytes = fromHex(result.chainCode)
        return {
          publicKey: () => pkBytes,
          rootChainCode: () => ccBytes,
          toBytes: () => ksBytes,
          keyId: () => pkBytes,
          free: () => {},
        } as unknown as MpcKeyshare
      },
      free: (h) => ExpoMpcNative.freeSchnorrKeygenSession(h),
    })
  }

  signSetup(
    keyId: Uint8Array,
    chainPath: string,
    messageHash: Uint8Array,
    partyIds: string[]
  ): Uint8Array {
    const b64 = ExpoMpcNative.schnorrSignSetup(
      toBase64(keyId),
      chainPath,
      toBase64(messageHash),
      partyIds
    )
    return fromBase64(b64)
  }

  signSetupMessageHash(setupMsg: Uint8Array): Uint8Array | undefined {
    const b64 = ExpoMpcNative.schnorrDecodeMessage(toBase64(setupMsg))
    return b64 ? fromBase64(b64) : undefined
  }

  signSetupKeyId(setupMsg: Uint8Array): Uint8Array | undefined {
    const b64 = ExpoMpcNative.schnorrDecodeKeyId(toBase64(setupMsg))
    return b64 ? fromBase64(b64) : undefined
  }

  createSignSession(
    setup: Uint8Array,
    localPartyId: string,
    keyshare: MpcKeyshare
  ): MpcSession<Uint8Array> {
    const nativeKs = this._ensureNativeKeyshare(keyshare)
    const isTemporary = !(keyshare instanceof NativeKeyshare && keyshare.kind === 'schnorr')
    const handle = ExpoMpcNative.createSchnorrSignSession(
      toBase64(setup),
      localPartyId,
      nativeKs.handle
    )
    // Free temporary handle after Go has copied the data during session creation
    if (isTemporary) {
      nativeKs.free()
    }
    return new NativeSession<Uint8Array>(handle, {
      outputMessage: (h) => ExpoMpcNative.schnorrSignSessionOutputMessage(h),
      messageReceiver: (h, m, i) =>
        ExpoMpcNative.schnorrSignSessionMessageReceiver(h, m, i),
      inputMessage: (h, m) =>
        ExpoMpcNative.schnorrSignSessionInputMessage(h, m),
      finish: (h) => fromBase64(ExpoMpcNative.finishSchnorrSign(h)),
      free: (h) => ExpoMpcNative.freeSchnorrSignSession(h),
    })
  }

  keyshareFromBytes(bytes: Uint8Array): MpcKeyshare {
    const handle = ExpoMpcNative.schnorrKeyshareFromBytes(toBase64(bytes))
    return new NativeKeyshare(handle, bytes, 'schnorr')
  }

  reshareSetup(
    keyshare: MpcKeyshare,
    allPartyIds: string[],
    oldIndices: Uint8Array,
    threshold: number,
    newIndices: Uint8Array
  ): Uint8Array {
    const nativeKs = this._ensureNativeKeyshare(keyshare)
    const isTemporary = !(keyshare instanceof NativeKeyshare && keyshare.kind === 'schnorr')
    try {
      const b64 = ExpoMpcNative.schnorrQcSetup(
        nativeKs.handle,
        allPartyIds,
        toBase64(oldIndices),
        threshold,
        toBase64(newIndices)
      )
      return fromBase64(b64)
    } finally {
      // Free the temporary handle if we created one via _ensureNativeKeyshare
      if (isTemporary) {
        nativeKs.free()
      }
    }
  }

  createReshareSession(
    setup: Uint8Array,
    localPartyId: string,
    keyshare: MpcKeyshare | null
  ): MpcSession<MpcKeyshare | undefined> {
    // If keyshare is not a native handle (e.g. it was deserialized from bytes),
    // _ensureNativeKeyshare creates a temporary native handle. We track whether
    // it was temporary so it can be freed after the session is created —
    // the session only needs the handle during setup, not for its lifetime.
    let tempKeyshare: NativeKeyshare | null = null
    let ksHandle: number | null = null
    if (keyshare) {
      const nativeKs = this._ensureNativeKeyshare(keyshare)
      const isTemporary = !(keyshare instanceof NativeKeyshare && keyshare.kind === 'schnorr')
      ksHandle = nativeKs.handle
      if (isTemporary) {
        tempKeyshare = nativeKs
      }
    }

    let handle: number
    try {
      handle = ExpoMpcNative.createSchnorrQcSession(toBase64(setup), localPartyId, ksHandle)
    } finally {
      // Free the temporary native keyshare now that the session has been created
      tempKeyshare?.free()
    }

    return new NativeSession<MpcKeyshare | undefined>(handle, {
      outputMessage: (h) => ExpoMpcNative.schnorrQcSessionOutputMessage(h),
      messageReceiver: (h, m, i) =>
        ExpoMpcNative.schnorrQcSessionMessageReceiver(h, m, i),
      inputMessage: (h, m) =>
        ExpoMpcNative.schnorrQcSessionInputMessage(h, m),
      finish: (h) => {
        const resultHandle = ExpoMpcNative.finishSchnorrQc(h)
        return resultHandle >= 0
          ? new NativeKeyshare(resultHandle, null, 'schnorr')
          : undefined
      },
      free: (h) => ExpoMpcNative.freeSchnorrQcSession(h),
    })
  }

  createKeyImportInitiator(
    privateKey: Uint8Array,
    rootChainCode: Uint8Array | null | undefined,
    threshold: number,
    partyIds: string[]
  ): { session: MpcSession<MpcKeyshare>; setup: Uint8Array } {
    const result = ExpoMpcNative.createSchnorrKeyImportInitiator(
      toHex(privateKey),
      rootChainCode ? toHex(rootChainCode) : null,
      threshold,
      partyIds
    )
    const session = this._makeKeygenSession(result.sessionHandle)
    return { session, setup: fromBase64(result.setupMessage) }
  }

  async createKeyImportSession(
    setup: Uint8Array,
    localPartyId: string
  ): Promise<MpcSession<MpcKeyshare>> {
    const handle = await ExpoMpcNative.createSchnorrKeyImportSession(
      toBase64(setup),
      localPartyId
    )
    return this._makeKeygenSession(handle)
  }

  // --- Private helpers ---

  private _ensureNativeKeyshare(ks: MpcKeyshare): NativeKeyshare {
    if (ks instanceof NativeKeyshare && ks.kind === 'schnorr') {
      return ks
    }
    const bytes = ks.toBytes()
    const handle = ExpoMpcNative.schnorrKeyshareFromBytes(toBase64(bytes))
    return new NativeKeyshare(handle, bytes, 'schnorr')
  }

  private _makeKeygenSession(handle: number): MpcSession<MpcKeyshare> {
    return new NativeSession<MpcKeyshare>(handle, {
      outputMessage: (h) =>
        ExpoMpcNative.schnorrKeygenSessionOutputMessage(h),
      messageReceiver: (h, m, i) =>
        ExpoMpcNative.schnorrKeygenSessionMessageReceiver(h, m, i),
      inputMessage: (h, m) =>
        ExpoMpcNative.schnorrKeygenSessionInputMessage(h, m),
      finish: async (h) => {
        const result = await ExpoMpcNative.finishSchnorrKeygen(h)
        const ksBytes = fromBase64(result.keyshare)
        const pkBytes = fromHex(result.publicKey)
        const ccBytes = fromHex(result.chainCode)
        return {
          publicKey: () => pkBytes,
          rootChainCode: () => ccBytes,
          toBytes: () => ksBytes,
          keyId: () => pkBytes,
          free: () => {},
        } as unknown as MpcKeyshare
      },
      free: (h) => ExpoMpcNative.freeSchnorrKeygenSession(h),
    })
  }
}

// ---------------------------------------------------------------------------
// NativeMpcEngine
// ---------------------------------------------------------------------------

export class NativeMpcEngine implements MpcEngine {
  readonly dkls: DklsEngine = new NativeDklsEngine()
  readonly schnorr: SchnorrEngine = new NativeSchnorrEngine()

  async initialize(): Promise<void> {
    // Native modules are loaded eagerly by Expo; nothing to do here.
  }
}

// Re-export raw native module for direct access (used by apps for keygen flows)
export { default as ExpoMpcNative } from "./ExpoMpcNativeModule"
