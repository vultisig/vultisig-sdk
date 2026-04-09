/**
 * @vultisig/walletcore-native
 *
 * Native WalletCore bridge for React Native / Expo.
 * Provides a JS object matching the WalletCore API shape expected by the SDK.
 */
import { keccak_256 } from '@noble/hashes/sha3'
import ExpoWalletCore from './ExpoWalletCoreModule'

// ---------------------------------------------------------------------------
// Types — matches the subset of @trustwallet/wallet-core's WalletCore interface
// that the SDK actually uses.
// ---------------------------------------------------------------------------

export interface NativePublicKeyInstance {
  readonly _handle: number
  data(): Uint8Array
  uncompressed(): NativePublicKeyInstance
  compressed(): NativePublicKeyInstance
  verify(signature: Uint8Array, message: Uint8Array): boolean
  verifyAsDER(signature: Uint8Array, message: Uint8Array): boolean
  delete(): void
}

export interface NativePrivateKeyInstance {
  readonly _handle: number
  data(): Uint8Array
  getPublicKeySecp256k1(compressed: boolean): NativePublicKeyInstance
  getPublicKeyEd25519(): NativePublicKeyInstance
  delete(): void
}

export interface NativeHDWalletInstance {
  readonly _handle: number
  getMasterKey(curve: number): NativePrivateKeyInstance
  getKeyForCoin(coinType: number): NativePrivateKeyInstance
  getKeyDerivation(coinType: number, derivation: number): NativePrivateKeyInstance
  getAddressDerivation(coinType: number, derivation: number): string
  getKey(coinType: number, derivationPath: string): NativePrivateKeyInstance
  getAddressForCoin(coinType: number): string
  getExtendedPrivateKey(purpose: number, coinType: number, version: number): string
  delete(): void
}

export interface NativeEthereumAbiFunctionInstance {
  addParamUInt8(val: number, isOutput: boolean): number
  addParamUInt16(val: number, isOutput: boolean): number
  addParamUInt32(val: number, isOutput: boolean): number
  addParamUInt64(val: number, isOutput: boolean): number
  addParamUInt256(val: Uint8Array | Buffer, isOutput: boolean): number
  addParamInt8(val: number, isOutput: boolean): number
  addParamInt16(val: number, isOutput: boolean): number
  addParamInt32(val: number, isOutput: boolean): number
  addParamInt64(val: number, isOutput: boolean): number
  addParamInt256(val: Uint8Array | Buffer, isOutput: boolean): number
  addParamBool(val: boolean, isOutput: boolean): number
  addParamString(val: string, isOutput: boolean): number
  addParamAddress(val: Uint8Array | Buffer, isOutput: boolean): number
  addParamBytes(val: Uint8Array | Buffer, isOutput: boolean): number
  addParamBytesFix(size: number, val: Uint8Array | Buffer, isOutput: boolean): number
  delete(): void
}

export interface NativeDataVectorInstance {
  readonly items: string[]
  add(data: Uint8Array): void
}

export interface NativeAnyAddressInstance {
  description(): string
  data(): Uint8Array
}

/** Subset of @trustwallet/wallet-core's WalletCore interface provided natively. */
export interface WalletCoreLike {
  CoinType: Record<string, number>
  PublicKeyType: Record<string, number>
  Curve: Record<string, number>
  Purpose: Record<string, number>
  HDVersion: Record<string, number>

  CoinTypeExt: {
    derivationPath(coinType: number): string
    deriveAddressFromPublicKey(coinType: number, publicKey: NativePublicKeyInstance): string
    chainId(coinType: number): string
    ss58Prefix(coinType: number): number
  }

  PublicKey: {
    createWithData(data: Uint8Array | Buffer, type: number): NativePublicKeyInstance
  }

  AnyAddress: {
    isValid(address: string, coinType: number): boolean
    isValidBech32(address: string, coinType: number, hrp: string): boolean
    isValidSS58(address: string, coinType: number, ss58Prefix: number): boolean
    createWithString(address: string, coinType: number): NativeAnyAddressInstance
    createBech32WithPublicKey(publicKey: NativePublicKeyInstance, coinType: number, hrp: string): NativeAnyAddressInstance
    createBech32(address: string, coinType: number, hrp: string): NativeAnyAddressInstance
  }

  TransactionCompiler: {
    preImageHashes(coinType: number, txInputData: Uint8Array): Uint8Array
    compileWithSignatures(coinType: number, txInputData: Uint8Array, signatures: NativeDataVectorInstance, publicKeys: NativeDataVectorInstance): Uint8Array
  }

  DataVector: {
    create(): NativeDataVectorInstance
  }

  HDWallet: {
    createWithMnemonic(mnemonic: string, passphrase?: string): NativeHDWalletInstance
  }

  PrivateKey: {
    create(): NativePrivateKeyInstance
  }

  AnySigner: {
    plan(txInputData: Uint8Array, coinType: number): Uint8Array
  }

  HexCoding: {
    decode(hex: string): Uint8Array
    encode(data: Uint8Array): string
  }

  Bech32: {
    encode(hrp: string, data: Uint8Array): string
  }

  BitcoinScript: {
    buildPayToWitnessPubkeyHash(hash: Uint8Array): { data(): Uint8Array }
    buildPayToPublicKeyHash(hash: Uint8Array): { data(): Uint8Array }
    lockScriptForAddress(address: string, coinType: number): { data(): Uint8Array }
    hashTypeForCoin(coinType: number): number
  }

  TONAddressConverter: {
    toUserFriendly(address: string): string
  }

  EthereumAbiFunction: {
    createWithString(name: string): NativeEthereumAbiFunctionInstance
  }

  EthereumAbi: {
    encode(fn: NativeEthereumAbiFunctionInstance): Uint8Array
    encodeTyped(messageJson: string): string
  }

  Mnemonic: {
    isValid(mnemonic: string): boolean
  }

  SolanaAddress: {
    createWithString(address: string): { defaultTokenAddress(tokenMintAddress: string): string }
  }
}

// ---------------------------------------------------------------------------
// Helpers — base64 <-> Uint8Array
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array | Buffer): string {
  if (Buffer.isBuffer(bytes)) {
    return bytes.toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
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
// CoinType enum — numeric values matching TrustWallet's CoinType
// Values sourced from TrustWallet wallet-core v4.2.9:
// https://github.com/trustwallet/wallet-core/blob/v4.2.9/include/TrustWalletCore/TWCoinType.h
// ---------------------------------------------------------------------------

const CoinTypeValues: Record<string, number> = {
  bitcoin: 0,
  litecoin: 2,
  dogecoin: 3,
  dash: 5,
  ethereum: 60,
  cosmos: 118,
  zcash: 133,
  ripple: 144, // xrp
  xrp: 144,
  bitcoinCash: 145,
  tron: 195,
  terra: 330,
  polkadot: 354,
  ton: 607,
  solana: 501,
  thorchain: 931,
  sui: 784,
  cardano: 1815,
  smartChain: 20000714,
  arbitrum: 10042221,
  avalancheCChain: 10009000,
  base: 8453,
  polygon: 966,
  optimism: 10000070,
  cronosChain: 10000025,
  blast: 81457,
  zksync: 10000324,
  osmosis: 10000118,
  terraV2: 10000330,
  noble: 18000118,
  kujira: 70000118,
  dydx: 22000118,
  akash: 17000118,
  mantle: 5000,
  sei: 19000118,
}

// ---------------------------------------------------------------------------
// PublicKeyType enum
// ---------------------------------------------------------------------------

const PublicKeyTypeValues: Record<string, number> = {
  secp256k1: 0,
  secp256k1Extended: 1,
  nist256p1: 2,
  nist256p1Extended: 3,
  ed25519: 4,
  ed25519Blake2b: 5,
  curve25519: 6,
  ed25519Cardano: 7,
  starkex: 8,
}

// ---------------------------------------------------------------------------
// Curve enum
// ---------------------------------------------------------------------------

const CurveValues: Record<string, number> = {
  secp256k1: 0,
  ed25519: 1,
  ed25519Blake2bNano: 2,
  curve25519: 3,
  nist256p1: 4,
  ed25519ExtendedCardano: 5,
  starkex: 6,
}

// ---------------------------------------------------------------------------
// Purpose enum
// ---------------------------------------------------------------------------

const PurposeValues: Record<string, number> = {
  bip44: 44,
  bip49: 49,
  bip84: 84,
  bip1852: 1852,
}

// ---------------------------------------------------------------------------
// HDVersion enum
// ---------------------------------------------------------------------------

const HDVersionValues: Record<string, number> = {
  none: 0,
  xpub: 1,
  xprv: 2,
  ypub: 3,
  yprv: 4,
  zpub: 5,
  zprv: 6,
}

// ---------------------------------------------------------------------------
// NativePublicKey — wraps a native handle
//
// NOTE: This class does NOT use automatic cleanup via FinalizationRegistry.
// The native handle allocated on the C++ side must be released explicitly by
// calling delete() when the instance is no longer needed. Failure to do so
// will leak native memory. A FinalizationRegistry could be used to register
// a fallback cleanup callback, but garbage-collection timing is non-deterministic
// and should not be relied upon for timely resource reclamation.
// ---------------------------------------------------------------------------

class NativePublicKey implements NativePublicKeyInstance {
  readonly _handle: number

  constructor(handle: number) {
    this._handle = handle
  }

  data(): Uint8Array {
    return fromBase64(ExpoWalletCore.publicKeyData(this._handle))
  }

  uncompressed(): NativePublicKey {
    return new NativePublicKey(ExpoWalletCore.publicKeyUncompressed(this._handle))
  }

  compressed(): NativePublicKey {
    return new NativePublicKey(ExpoWalletCore.publicKeyCompressed(this._handle))
  }

  verify(signature: Uint8Array, message: Uint8Array): boolean {
    return ExpoWalletCore.publicKeyVerify(this._handle, toBase64(signature), toBase64(message))
  }

  verifyAsDER(signature: Uint8Array, message: Uint8Array): boolean {
    return ExpoWalletCore.publicKeyVerifyAsDER(this._handle, toBase64(signature), toBase64(message))
  }

  delete(): void {
    ExpoWalletCore.freePublicKey(this._handle)
  }
}

// ---------------------------------------------------------------------------
// NativePrivateKey — wraps a native handle
//
// NOTE: This class does NOT use automatic cleanup via FinalizationRegistry.
// The native handle allocated on the C++ side must be released explicitly by
// calling delete() when the instance is no longer needed. Failure to do so
// will leak native memory. A FinalizationRegistry could be used to register
// a fallback cleanup callback, but garbage-collection timing is non-deterministic
// and should not be relied upon for timely resource reclamation.
// ---------------------------------------------------------------------------

class NativePrivateKey implements NativePrivateKeyInstance {
  readonly _handle: number

  constructor(handle: number) {
    this._handle = handle
  }

  data(): Uint8Array {
    return fromBase64(ExpoWalletCore.privateKeyData(this._handle))
  }

  getPublicKeySecp256k1(compressed: boolean): NativePublicKey {
    return new NativePublicKey(ExpoWalletCore.privateKeyGetPublicKeySecp256k1(this._handle, compressed))
  }

  getPublicKeyEd25519(): NativePublicKey {
    return new NativePublicKey(ExpoWalletCore.privateKeyGetPublicKeyEd25519(this._handle))
  }

  delete(): void {
    ExpoWalletCore.freePrivateKey(this._handle)
  }
}

// ---------------------------------------------------------------------------
// NativeHDWallet — wraps a native handle
//
// NOTE: This class does NOT use automatic cleanup via FinalizationRegistry.
// The native handle allocated on the C++ side must be released explicitly by
// calling delete() when the instance is no longer needed. Failure to do so
// will leak native memory. A FinalizationRegistry could be used to register
// a fallback cleanup callback, but garbage-collection timing is non-deterministic
// and should not be relied upon for timely resource reclamation.
// ---------------------------------------------------------------------------

class NativeHDWallet implements NativeHDWalletInstance {
  readonly _handle: number

  constructor(handle: number) {
    this._handle = handle
  }

  getMasterKey(curve: number): NativePrivateKey {
    return new NativePrivateKey(ExpoWalletCore.hdWalletGetMasterKey(this._handle, curve))
  }

  getKeyForCoin(coinType: number): NativePrivateKey {
    return new NativePrivateKey(ExpoWalletCore.hdWalletGetKeyForCoin(this._handle, coinType))
  }

  getKeyDerivation(coinType: number, derivation: number): NativePrivateKey {
    return new NativePrivateKey(ExpoWalletCore.hdWalletGetKeyDerivation(this._handle, coinType, derivation))
  }

  getAddressDerivation(coinType: number, derivation: number): string {
    return ExpoWalletCore.hdWalletGetAddressDerivation(this._handle, coinType, derivation)
  }

  getKey(coinType: number, derivationPath: string): NativePrivateKey {
    return new NativePrivateKey(ExpoWalletCore.hdWalletGetKey(this._handle, coinType, derivationPath))
  }

  getAddressForCoin(coinType: number): string {
    return ExpoWalletCore.hdWalletGetAddressForCoin(this._handle, coinType)
  }

  getExtendedPrivateKey(purpose: number, coinType: number, version: number): string {
    return ExpoWalletCore.hdWalletGetExtendedPrivateKey(this._handle, purpose, coinType, version)
  }

  delete(): void {
    ExpoWalletCore.freeHDWallet(this._handle)
  }
}

// ---------------------------------------------------------------------------
// NativeDataVector — wraps signature/pubkey arrays
// ---------------------------------------------------------------------------

class NativeDataVector implements NativeDataVectorInstance {
  readonly items: string[] = []

  add(data: Uint8Array): void {
    this.items.push(toBase64(data))
  }
}

// ---------------------------------------------------------------------------
// NativeAnyAddress — wraps address results
// ---------------------------------------------------------------------------

class NativeAnyAddress implements NativeAnyAddressInstance {
  private readonly _description: string
  private readonly _data: string | null

  constructor(description: string, data: string | null = null) {
    this._description = description
    this._data = data
  }

  description(): string {
    return this._description
  }

  data(): Uint8Array {
    return this._data ? fromBase64(this._data) : new Uint8Array(0)
  }
}

// ---------------------------------------------------------------------------
// ABI encoding helpers — pure JS implementation of Solidity ABI encoding.
// Used by NativeEthereumAbiFunction to avoid bridging the full stateful
// EthereumAbiFunction class through native modules.
// ---------------------------------------------------------------------------

type AbiParam =
  | { type: 'address'; value: Uint8Array }
  | { type: 'uint256'; value: Uint8Array }
  | { type: 'int256'; value: Uint8Array }
  | { type: 'uint8'; value: number }
  | { type: 'uint16'; value: number }
  | { type: 'uint32'; value: number }
  | { type: 'uint64'; value: number }
  | { type: 'int8'; value: number }
  | { type: 'int16'; value: number }
  | { type: 'int32'; value: number }
  | { type: 'int64'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'bytes'; value: Uint8Array }
  | { type: `bytes${number}`; value: Uint8Array }

/** Pad a Uint8Array to 32 bytes, left-aligned (for static types). */
function padLeft(data: Uint8Array, len = 32): Uint8Array {
  const padded = new Uint8Array(len)
  padded.set(data, len - data.length)
  return padded
}

/** Pad a Uint8Array to a multiple of 32 bytes, right-aligned (for dynamic data). */
function padRight(data: Uint8Array): Uint8Array {
  const paddedLen = Math.ceil(data.length / 32) * 32
  const padded = new Uint8Array(paddedLen)
  padded.set(data, 0)
  return padded
}

function isDynamic(param: AbiParam): boolean {
  return param.type === 'string' || param.type === 'bytes'
}

function abiTypeString(param: AbiParam): string {
  return param.type
}

function uint256FromNumber(n: number): Uint8Array {
  const buf = new Uint8Array(32)
  // Write as big-endian — fit in last 8 bytes for safety
  let val = BigInt(n)
  for (let i = 31; i >= 0 && val > 0n; i--) {
    buf[i] = Number(val & 0xffn)
    val >>= 8n
  }
  return buf
}

function int256FromNumber(n: number): Uint8Array {
  let val = BigInt(n)
  if (val < 0n) {
    // Two's complement for 256-bit
    val = (1n << 256n) + val
  }
  const buf = new Uint8Array(32)
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(val & 0xffn)
    val >>= 8n
  }
  return buf
}

/** Compute the 4-byte function selector: keccak256(signature)[:4]. */
function functionSelector(name: string, params: AbiParam[]): Uint8Array {
  const sig = `${name}(${params.map(abiTypeString).join(',')})`
  return keccak_256(new TextEncoder().encode(sig)).slice(0, 4)
}

/** ABI-encode a function call: selector + encoded parameters. */
function abiEncode(name: string, params: AbiParam[]): Uint8Array {
  const selector = functionSelector(name, params)

  // Head: for static types, the encoded value; for dynamic types, an offset pointer.
  // Tail: dynamic type data appended after the head section.
  const headParts: Uint8Array[] = []
  const tailParts: Uint8Array[] = []

  // The head section has 32 bytes per parameter.
  let dynamicOffset = params.length * 32

  for (const param of params) {
    if (isDynamic(param)) {
      // Head slot = offset to tail data
      headParts.push(uint256FromNumber(dynamicOffset))

      let encoded: Uint8Array
      if (param.type === 'string') {
        const strBytes = new TextEncoder().encode(param.value as string)
        const lenSlot = uint256FromNumber(strBytes.length)
        const paddedData = padRight(strBytes)
        encoded = new Uint8Array(lenSlot.length + paddedData.length)
        encoded.set(lenSlot, 0)
        encoded.set(paddedData, lenSlot.length)
      } else {
        // bytes
        const bytesVal = param.value as Uint8Array
        const lenSlot = uint256FromNumber(bytesVal.length)
        const paddedData = padRight(bytesVal)
        encoded = new Uint8Array(lenSlot.length + paddedData.length)
        encoded.set(lenSlot, 0)
        encoded.set(paddedData, lenSlot.length)
      }
      tailParts.push(encoded)
      dynamicOffset += encoded.length
    } else {
      // Static types — encode inline in head
      let encoded: Uint8Array
      switch (param.type) {
        case 'address':
          // Address is 20 bytes, left-padded to 32
          encoded = padLeft(param.value as Uint8Array)
          break
        case 'uint256':
          // Already big-endian bytes, pad to 32
          encoded = padLeft(param.value as Uint8Array)
          break
        case 'int256':
          encoded = padLeft(param.value as Uint8Array)
          break
        case 'bool':
          encoded = uint256FromNumber(param.value ? 1 : 0)
          break
        case 'uint8':
        case 'uint16':
        case 'uint32':
        case 'uint64':
          encoded = uint256FromNumber(param.value as number)
          break
        case 'int8':
        case 'int16':
        case 'int32':
        case 'int64':
          encoded = int256FromNumber(param.value as number)
          break
        default:
          if (param.type.startsWith('bytes')) {
            // bytesN (fixed-size) — right-padded to 32
            encoded = padRight(param.value as Uint8Array)
          } else {
            throw new Error(`Unsupported ABI param type: ${param.type}`)
          }
      }
      headParts.push(encoded)
    }
  }

  // Concatenate: selector + heads + tails
  const totalLen =
    selector.length +
    headParts.reduce((sum, p) => sum + p.length, 0) +
    tailParts.reduce((sum, p) => sum + p.length, 0)

  const result = new Uint8Array(totalLen)
  let offset = 0
  result.set(selector, offset)
  offset += selector.length
  for (const part of headParts) {
    result.set(part, offset)
    offset += part.length
  }
  for (const part of tailParts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

// ---------------------------------------------------------------------------
// NativeEthereumAbiFunction — pure JS ABI function encoder
// ---------------------------------------------------------------------------

class NativeEthereumAbiFunction implements NativeEthereumAbiFunctionInstance {
  readonly name: string
  private params: AbiParam[] = []

  constructor(name: string) {
    this.name = name
  }

  addParamUInt8(val: number, _isOutput: boolean): number {
    this.params.push({ type: 'uint8', value: val })
    return this.params.length - 1
  }

  addParamUInt16(val: number, _isOutput: boolean): number {
    this.params.push({ type: 'uint16', value: val })
    return this.params.length - 1
  }

  addParamUInt32(val: number, _isOutput: boolean): number {
    this.params.push({ type: 'uint32', value: val })
    return this.params.length - 1
  }

  addParamUInt64(val: number, _isOutput: boolean): number {
    this.params.push({ type: 'uint64', value: val })
    return this.params.length - 1
  }

  addParamUInt256(val: Uint8Array | Buffer, _isOutput: boolean): number {
    this.params.push({ type: 'uint256', value: Uint8Array.from(val) })
    return this.params.length - 1
  }

  addParamInt8(val: number, _isOutput: boolean): number {
    this.params.push({ type: 'int8', value: val })
    return this.params.length - 1
  }

  addParamInt16(val: number, _isOutput: boolean): number {
    this.params.push({ type: 'int16', value: val })
    return this.params.length - 1
  }

  addParamInt32(val: number, _isOutput: boolean): number {
    this.params.push({ type: 'int32', value: val })
    return this.params.length - 1
  }

  addParamInt64(val: number, _isOutput: boolean): number {
    this.params.push({ type: 'int64', value: val })
    return this.params.length - 1
  }

  addParamInt256(val: Uint8Array | Buffer, _isOutput: boolean): number {
    this.params.push({ type: 'int256', value: Uint8Array.from(val) })
    return this.params.length - 1
  }

  addParamBool(val: boolean, _isOutput: boolean): number {
    this.params.push({ type: 'bool', value: val })
    return this.params.length - 1
  }

  addParamString(val: string, _isOutput: boolean): number {
    this.params.push({ type: 'string', value: val })
    return this.params.length - 1
  }

  addParamAddress(val: Uint8Array | Buffer, _isOutput: boolean): number {
    this.params.push({ type: 'address', value: Uint8Array.from(val) })
    return this.params.length - 1
  }

  addParamBytes(val: Uint8Array | Buffer, _isOutput: boolean): number {
    this.params.push({ type: 'bytes', value: Uint8Array.from(val) })
    return this.params.length - 1
  }

  addParamBytesFix(size: number, val: Uint8Array | Buffer, _isOutput: boolean): number {
    this.params.push({ type: `bytes${size}`, value: Uint8Array.from(val) })
    return this.params.length - 1
  }

  /** Encode this function call as ABI calldata. */
  encode(): Uint8Array {
    return abiEncode(this.name, this.params)
  }

  delete(): void {
    // No-op — pure JS, nothing to free.
  }
}

// ---------------------------------------------------------------------------
// NativeWalletCore — the main facade
// ---------------------------------------------------------------------------

export class NativeWalletCore {
  private static instance: WalletCoreLike | null = null

  static getInstance(): WalletCoreLike {
    if (NativeWalletCore.instance) {
      return NativeWalletCore.instance
    }

    const wc: WalletCoreLike = {
      // --- CoinType enum ---
      CoinType: { ...CoinTypeValues },

      // --- PublicKeyType enum ---
      PublicKeyType: { ...PublicKeyTypeValues },

      // --- Curve enum ---
      Curve: { ...CurveValues },

      // --- Purpose enum ---
      Purpose: { ...PurposeValues },

      // --- HDVersion enum ---
      HDVersion: { ...HDVersionValues },

      // --- CoinTypeExt ---
      CoinTypeExt: {
        derivationPath(coinType: number): string {
          return ExpoWalletCore.derivationPath(coinType)
        },
        deriveAddressFromPublicKey(coinType: number, publicKey: NativePublicKey): string {
          return ExpoWalletCore.deriveAddressFromPublicKey(coinType, publicKey._handle)
        },
        chainId(coinType: number): string {
          return ExpoWalletCore.chainId(coinType)
        },
        ss58Prefix(coinType: number): number {
          return ExpoWalletCore.ss58Prefix(coinType)
        },
      },

      // --- PublicKey ---
      PublicKey: {
        createWithData(data: Uint8Array | Buffer, type: number): NativePublicKey {
          const handle = ExpoWalletCore.publicKeyCreateWithData(toBase64(data), type)
          return new NativePublicKey(handle)
        },
      },

      // --- AnyAddress ---
      AnyAddress: {
        isValid(address: string, coinType: number): boolean {
          return ExpoWalletCore.anyAddressIsValid(address, coinType)
        },
        isValidBech32(address: string, coinType: number, hrp: string): boolean {
          return ExpoWalletCore.anyAddressIsValidBech32(address, coinType, hrp)
        },
        isValidSS58(address: string, coinType: number, ss58Prefix: number): boolean {
          return ExpoWalletCore.anyAddressIsValidSS58(address, coinType, ss58Prefix)
        },
        createWithString(address: string, coinType: number): NativeAnyAddress {
          const desc = ExpoWalletCore.anyAddressCreateWithString(address, coinType)
          const dataB64 = ExpoWalletCore.anyAddressData(address, coinType)
          return new NativeAnyAddress(desc, dataB64)
        },
        createBech32WithPublicKey(
          publicKey: NativePublicKey,
          coinType: number,
          hrp: string
        ): NativeAnyAddress {
          const desc = ExpoWalletCore.anyAddressCreateBech32WithPublicKey(
            publicKey._handle,
            coinType,
            hrp
          )
          return new NativeAnyAddress(desc)
        },
        createBech32(address: string, coinType: number, hrp: string): NativeAnyAddress {
          const desc = ExpoWalletCore.anyAddressCreateBech32(address, coinType, hrp)
          return new NativeAnyAddress(desc)
        },
      },

      // --- TransactionCompiler ---
      TransactionCompiler: {
        preImageHashes(coinType: number, txInputData: Uint8Array): Uint8Array {
          const result = ExpoWalletCore.preImageHashes(coinType, toBase64(txInputData))
          return fromBase64(result)
        },
        compileWithSignatures(
          coinType: number,
          txInputData: Uint8Array,
          signatures: NativeDataVector,
          publicKeys: NativeDataVector
        ): Uint8Array {
          const result = ExpoWalletCore.compileWithSignatures(
            coinType,
            toBase64(txInputData),
            signatures.items,
            publicKeys.items
          )
          return fromBase64(result)
        },
      },

      // --- DataVector ---
      DataVector: {
        create(): NativeDataVector {
          return new NativeDataVector()
        },
      },

      // --- HDWallet ---
      HDWallet: {
        createWithMnemonic(mnemonic: string, passphrase: string = ''): NativeHDWallet {
          const handle = ExpoWalletCore.hdWalletCreate(mnemonic, passphrase)
          return new NativeHDWallet(handle)
        },
      },

      // --- PrivateKey ---
      PrivateKey: {
        create(): NativePrivateKey {
          const handle = ExpoWalletCore.privateKeyCreate()
          return new NativePrivateKey(handle)
        },
      },

      // --- AnySigner ---
      AnySigner: {
        plan(txInputData: Uint8Array, coinType: number): Uint8Array {
          const result = ExpoWalletCore.anySignerPlan(toBase64(txInputData), coinType)
          return fromBase64(result)
        },
      },

      // --- HexCoding ---
      HexCoding: {
        decode(hex: string): Uint8Array {
          const result = ExpoWalletCore.hexDecode(hex)
          return fromBase64(result)
        },
        encode(data: Uint8Array): string {
          return ExpoWalletCore.hexEncode(toBase64(data))
        },
      },

      // --- Bech32 ---
      Bech32: {
        encode(hrp: string, data: Uint8Array): string {
          return ExpoWalletCore.bech32Encode(hrp, toBase64(data))
        },
      },

      // --- BitcoinScript ---
      BitcoinScript: {
        buildPayToWitnessPubkeyHash(hash: Uint8Array): { data: () => Uint8Array } {
          const result = ExpoWalletCore.bitcoinScriptBuildPayToWitnessPubkeyHash(toBase64(hash))
          return { data: () => fromBase64(result) }
        },
        buildPayToPublicKeyHash(hash: Uint8Array): { data: () => Uint8Array } {
          const result = ExpoWalletCore.bitcoinScriptBuildPayToPublicKeyHash(toBase64(hash))
          return { data: () => fromBase64(result) }
        },
        lockScriptForAddress(address: string, coinType: number): { data: () => Uint8Array } {
          const result = ExpoWalletCore.bitcoinScriptLockScriptForAddress(address, coinType)
          return { data: () => fromBase64(result) }
        },
        hashTypeForCoin(coinType: number): number {
          return ExpoWalletCore.bitcoinScriptHashTypeForCoin(coinType)
        },
      },

      // --- TONAddressConverter ---
      TONAddressConverter: {
        toUserFriendly(address: string): string {
          return ExpoWalletCore.tonAddressToUserFriendly(address)
        },
      },

      // --- EthereumAbiFunction ---
      EthereumAbiFunction: {
        createWithString(name: string): NativeEthereumAbiFunction {
          return new NativeEthereumAbiFunction(name)
        },
      },

      // --- EthereumAbi ---
      EthereumAbi: {
        encode(fn: NativeEthereumAbiFunction): Uint8Array {
          return fn.encode()
        },
        encodeTyped(messageJson: string): string {
          return ExpoWalletCore.ethereumAbiEncodeTyped(messageJson)
        },
      },

      // --- Mnemonic ---
      Mnemonic: {
        isValid(mnemonic: string): boolean {
          return ExpoWalletCore.mnemonicIsValid(mnemonic)
        },
      },

      // --- SolanaAddress ---
      SolanaAddress: {
        createWithString(address: string): {
          defaultTokenAddress(tokenMintAddress: string): string
        } {
          return {
            defaultTokenAddress(tokenMintAddress: string): string {
              return ExpoWalletCore.solanaAddressDefaultTokenAddress(address, tokenMintAddress)
            },
          }
        },
      },
    }

    NativeWalletCore.instance = wc
    return wc
  }
}

// Re-export the raw native module for direct access
export { default as ExpoWalletCore } from './ExpoWalletCoreModule'
