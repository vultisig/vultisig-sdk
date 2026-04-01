/**
 * Schnorr (EdDSA) adapter for React Native
 *
 * Provides class-based API matching @lib/schnorr/vs_schnorr_wasm.d.ts
 * backed by @vultisig/expo-mpc native module calls.
 *
 * This module is aliased in place of @lib/schnorr/vs_schnorr_wasm during the
 * react-native Rollup build via alias plugin.
 */
import ExpoMpc from '@vultisig/expo-mpc'

// --- Helpers ---

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

function getReceivers(
  handleId: number,
  msgBase64: string,
  getReceiver: (
    handleId: number,
    msg: string,
    index: number
  ) => string | null
): string[] {
  const receivers: string[] = []
  let index = 0
  while (true) {
    const receiver = getReceiver(handleId, msgBase64, index)
    if (receiver === null) break
    receivers.push(receiver)
    index++
  }
  return receivers
}

const setupMessageHashes = new Map<string, Uint8Array>()

// --- Classes matching WASM API ---

export class Message {
  readonly body: Uint8Array
  readonly receivers: string[]

  constructor(body: Uint8Array, receivers: string[]) {
    this.body = body
    this.receivers = receivers
  }

  free(): void {}
}

export class Keyshare {
  private _handleId: number
  private _bytes: Uint8Array | null
  private _publicKey: Uint8Array | null
  private _keyId: Uint8Array | null

  private constructor(
    handleId: number,
    bytes: Uint8Array | null,
    publicKey: Uint8Array | null,
    keyId: Uint8Array | null
  ) {
    this._handleId = handleId
    this._bytes = bytes
    this._publicKey = publicKey
    this._keyId = keyId
  }

  static fromBytes(bytes: Uint8Array): Keyshare {
    const b64 = toBase64(bytes)
    const handleId = ExpoMpc.loadSchnorrKeyshare(b64)
    const keyIdB64 = ExpoMpc.getSchnorrKeyshareKeyId(handleId)
    return new Keyshare(handleId, new Uint8Array(bytes), null, fromBase64(keyIdB64))
  }

  _ensureHandle(): number {
    if (this._handleId < 0) {
      if (!this._bytes) throw new Error('Keyshare has no bytes to load from')
      this._handleId = ExpoMpc.loadSchnorrKeyshare(toBase64(this._bytes))
    }
    return this._handleId
  }

  static _fromFinishResult(result: {
    keyshare: string
    publicKey: string
  }): Keyshare {
    return new Keyshare(-1, fromBase64(result.keyshare), fromHex(result.publicKey), null)
  }

  publicKey(): Uint8Array {
    if (this._publicKey) return this._publicKey
    throw new Error('Public key not available synchronously.')
  }

  keyId(): Uint8Array {
    if (this._keyId) return this._keyId
    throw new Error('Key ID not available synchronously.')
  }

  toBytes(): Uint8Array {
    if (this._bytes) return this._bytes
    throw new Error('Keyshare bytes not available')
  }

  rootChainCode(): Uint8Array {
    // EdDSA keyshares don't have chain codes
    return new Uint8Array(32)
  }

  free(): void {
    if (this._handleId >= 0) {
      ExpoMpc.freeSchnorrSession(this._handleId)
      this._handleId = -1
    }
  }
}

export class KeygenSession {
  private _handleId: number

  constructor(setup: Uint8Array, id: string) {
    this._handleId = -1
    ;(this as any)._setupBase64 = toBase64(setup)
    ;(this as any)._localPartyId = id
  }

  async _init(): Promise<void> {
    if (this._handleId >= 0) return
    this._handleId = await ExpoMpc.createSchnorrKeygenSession(
      (this as any)._setupBase64,
      (this as any)._localPartyId
    )
  }

  static setup(
    key_id: Uint8Array | null | undefined,
    threshold: number,
    ids: string[]
  ): Uint8Array {
    throw new Error(
      'KeygenSession.setup() is not available synchronously on React Native.'
    )
  }

  static setupKeyId(setup_msg: Uint8Array): Uint8Array | undefined {
    return undefined
  }

  static refresh(
    setup: Uint8Array,
    id: string,
    old_share: Keyshare
  ): KeygenSession {
    throw new Error('Not yet supported on React Native')
  }

  static migrate(
    setup: Uint8Array,
    id: string,
    s_i_0: Uint8Array,
    public_key: Uint8Array,
    root_chain_code: Uint8Array
  ): KeygenSession {
    throw new Error('Not yet supported on React Native')
  }

  outputMessage(): Message | undefined {
    const msgBase64 = ExpoMpc.getSchnorrOutboundMessage(this._handleId)
    if (msgBase64 === null) return undefined

    const receivers = getReceivers(
      this._handleId,
      msgBase64,
      ExpoMpc.getSchnorrMessageReceiver.bind(ExpoMpc)
    )

    return new Message(fromBase64(msgBase64), receivers)
  }

  inputMessage(msg: Uint8Array): boolean {
    return ExpoMpc.inputSchnorrMessage(this._handleId, toBase64(msg))
  }

  finish(): Keyshare {
    throw new Error('Use ExpoMpc.finishSchnorrKeygen() directly.')
  }

  free(): void {
    if (this._handleId >= 0) {
      ExpoMpc.freeSchnorrSession(this._handleId)
      this._handleId = -1
    }
  }
}

export class SignSession {
  private _handleId: number

  constructor(setup: Uint8Array, id: string, share: Keyshare) {
    const keyshareHandle = (share as any)._handleId >= 0 ? (share as any)._handleId : ExpoMpc.loadSchnorrKeyshare(toBase64(share.toBytes()))
    this._handleId = ExpoMpc.createSchnorrSignSession(
      toBase64(setup),
      id,
      keyshareHandle
    )
  }

  static setup(
    key_id: Uint8Array,
    chain_path: string,
    message_hash: Uint8Array | null | undefined,
    ids: string[]
  ): Uint8Array {
    const keyIdB64 = toBase64(key_id)
    const msgHashHex = message_hash ? Buffer.from(message_hash).toString('hex') : ''
    const resultB64 = ExpoMpc.createSchnorrSignSetupMessage(keyIdB64, chain_path, msgHashHex, ids)
    const result = fromBase64(resultB64)
    if (message_hash) {
      const setupKey = toBase64(result.subarray(0, Math.min(32, result.length)))
      setupMessageHashes.set(setupKey, new Uint8Array(message_hash))
    }
    return result
  }

  static setupMessageHash(setup_msg: Uint8Array): Uint8Array | undefined {
    const setupKey = toBase64(setup_msg.subarray(0, Math.min(32, setup_msg.length)))
    return setupMessageHashes.get(setupKey)
  }

  static setupKeyId(setup_msg: Uint8Array): Uint8Array | undefined {
    return undefined
  }

  outputMessage(): Message | undefined {
    const msgBase64 = ExpoMpc.getSchnorrSignOutboundMessage(this._handleId)
    if (msgBase64 === null) return undefined

    const receivers = getReceivers(
      this._handleId,
      msgBase64,
      ExpoMpc.getSchnorrSignMessageReceiver.bind(ExpoMpc)
    )

    return new Message(fromBase64(msgBase64), receivers)
  }

  inputMessage(msg: Uint8Array): boolean {
    return ExpoMpc.inputSchnorrSignMessage(this._handleId, toBase64(msg))
  }

  finish(): Uint8Array {
    const sigHex = ExpoMpc.finishSchnorrSign(this._handleId)
    return fromHex(sigHex)
  }

  free(): void {
    if (this._handleId >= 0) {
      ExpoMpc.freeSchnorrSignSession(this._handleId)
      this._handleId = -1
    }
  }
}

export class QcSession {
  constructor(_setup: Uint8Array, _id: string, _keyshare?: Keyshare | null) {
    throw new Error('QcSession is not yet supported on React Native')
  }
  static setup(_keyshare: Keyshare, _ids: string[], _olds: Uint8Array, _threshold: number, _news: Uint8Array): Uint8Array {
    throw new Error('Not implemented')
  }
  static setupKeyId(_setup_msg: Uint8Array): Uint8Array | undefined { return undefined }
  outputMessage(): Message | undefined { throw new Error('Not implemented') }
  inputMessage(_msg: Uint8Array): boolean { throw new Error('Not implemented') }
  finish(): Keyshare | undefined { throw new Error('Not implemented') }
  free(): void {}
}

export class KeyImportInitiator {
  private _handleId: number
  readonly setup: Uint8Array

  constructor(
    private_key: Uint8Array,
    root_chain: Uint8Array | null | undefined,
    threshold: number,
    ids: string[]
  ) {
    this._handleId = -1
    this.setup = new Uint8Array()
    ;(this as any)._privateKeyHex = Buffer.from(private_key).toString('hex')
    ;(this as any)._chainCodeHex = root_chain ? Buffer.from(root_chain).toString('hex') : ''
    ;(this as any)._threshold = threshold
    ;(this as any)._ids = ids
  }

  async _init(): Promise<void> {
    if (this._handleId >= 0) return
    const result = await ExpoMpc.createSchnorrKeyImportSession(
      (this as any)._privateKeyHex,
      (this as any)._chainCodeHex,
      (this as any)._threshold,
      (this as any)._ids
    )
    this._handleId = result.sessionHandle
    ;(this as any).setup = fromBase64(result.setupMessage)
  }

  outputMessage(): Message | undefined {
    const msgBase64 = ExpoMpc.getSchnorrOutboundMessage(this._handleId)
    if (msgBase64 === null) return undefined
    const receivers = getReceivers(this._handleId, msgBase64, ExpoMpc.getSchnorrMessageReceiver.bind(ExpoMpc))
    return new Message(fromBase64(msgBase64), receivers)
  }

  inputMessage(msg: Uint8Array): boolean {
    return ExpoMpc.inputSchnorrMessage(this._handleId, toBase64(msg))
  }

  finish(): Keyshare {
    throw new Error('Use ExpoMpc.finishSchnorrKeygen() directly.')
  }

  free(): void {
    if (this._handleId >= 0) {
      ExpoMpc.freeSchnorrSession(this._handleId)
      this._handleId = -1
    }
  }
}

export class KeyImportSession {
  private _handleId: number

  constructor(setup: Uint8Array, id: string) {
    this._handleId = -1
    ;(this as any)._setupBase64 = toBase64(setup)
    ;(this as any)._localPartyId = id
  }

  async _init(): Promise<void> {
    if (this._handleId >= 0) return
    this._handleId = await ExpoMpc.createSchnorrKeygenSession(
      (this as any)._setupBase64,
      (this as any)._localPartyId
    )
  }

  outputMessage(): Message | undefined {
    const msgBase64 = ExpoMpc.getSchnorrOutboundMessage(this._handleId)
    if (msgBase64 === null) return undefined
    const receivers = getReceivers(this._handleId, msgBase64, ExpoMpc.getSchnorrMessageReceiver.bind(ExpoMpc))
    return new Message(fromBase64(msgBase64), receivers)
  }

  inputMessage(msg: Uint8Array): boolean {
    return ExpoMpc.inputSchnorrMessage(this._handleId, toBase64(msg))
  }

  finish(): Keyshare {
    throw new Error('Use ExpoMpc.finishSchnorrKeygen() directly.')
  }

  free(): void {
    if (this._handleId >= 0) {
      ExpoMpc.freeSchnorrSession(this._handleId)
      this._handleId = -1
    }
  }
}

export class KeyExportSession {
  constructor(_share: Keyshare, _ids: string[]) {
    throw new Error('KeyExportSession is not supported on React Native')
  }
  inputMessage(_msg: Uint8Array): boolean { throw new Error('Not implemented') }
  finish(): Uint8Array { throw new Error('Not implemented') }
  static exportShare(_setup: Uint8Array, _id: string, _share: Keyshare): Message {
    throw new Error('Not implemented')
  }
  readonly setup: Uint8Array = new Uint8Array()
  free(): void {}
}

export class HardDerivationSession {
  constructor(_setup: Uint8Array, _id: string, _share: Keyshare) {
    throw new Error('Not supported on React Native')
  }
  static setup(_key_id: Uint8Array, _chain_path: string, _ids: string[]): Uint8Array {
    throw new Error('Not implemented')
  }
  static setupKeyId(_setup_msg: Uint8Array): Uint8Array | undefined { return undefined }
  outputMessage(): Message | undefined { throw new Error('Not implemented') }
  inputMessage(_msg: Uint8Array): boolean { throw new Error('Not implemented') }
  finish(): Keyshare { throw new Error('Not implemented') }
  free(): void {}
}

export class FinalSession {
  constructor(_setup: Uint8Array, _id: string, _pre: PreSign) {
    throw new Error('Not supported on React Native')
  }
  static setup(_session_id: Uint8Array, _message_hash: Uint8Array, _ids: string[]): Uint8Array {
    throw new Error('Not implemented')
  }
  static setupMessageHash(_setup_msg: Uint8Array): Uint8Array | undefined { return undefined }
  static setupKeyId(_setup_msg: Uint8Array): Uint8Array | undefined { return undefined }
  outputMessage(): Message | undefined { throw new Error('Not implemented') }
  inputMessage(_msg: Uint8Array): boolean { throw new Error('Not implemented') }
  finish(): Uint8Array { throw new Error('Not implemented') }
  free(): void {}
}

export class PreSign {
  toBytes(): Uint8Array { throw new Error('Not implemented') }
  static fromBytes(_bytes: Uint8Array): PreSign { throw new Error('Not implemented') }
  free(): void {}
}

// Default export: init function (no-op on React Native)
export default function initSchnorr(): Promise<void> {
  return Promise.resolve()
}
