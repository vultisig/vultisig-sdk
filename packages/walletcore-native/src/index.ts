/**
 * @vultisig/walletcore-native
 *
 * Native WalletCore bridge for React Native / Expo.
 * Provides a JS object matching the WalletCore API shape expected by the SDK.
 */
import ExpoWalletCore from './ExpoWalletCoreModule'

// ---------------------------------------------------------------------------
// Helpers — base64 <-> Uint8Array
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array | Buffer): string {
  if (Buffer.isBuffer(bytes)) {
    return bytes.toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
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
  base: 10008453,
  polygon: 10000137,
  optimism: 10000010,
  cronosChain: 10000025,
  blast: 10081457,
  zksync: 10000324,
  osmosis: 10000118,
  terraV2: 10000118, // same underlying
  noble: 10000118,
  kujira: 10000118,
  dydx: 10000118,
  akash: 10000118,
  mantle: 10005000,
  sei: 60, // EVM chain
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
// ---------------------------------------------------------------------------

class NativePublicKey {
  readonly _handle: number

  constructor(handle: number) {
    this._handle = handle
  }

  data(): Uint8Array {
    return fromBase64(ExpoWalletCore.publicKeyData(this._handle))
  }

  uncompressed(): NativePublicKey {
    const handle = ExpoWalletCore.publicKeyUncompressed(this._handle)
    return new NativePublicKey(handle)
  }

  compressed(): NativePublicKey {
    const handle = ExpoWalletCore.publicKeyCompressed(this._handle)
    return new NativePublicKey(handle)
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
// ---------------------------------------------------------------------------

class NativePrivateKey {
  readonly _handle: number

  constructor(handle: number) {
    this._handle = handle
  }

  data(): Uint8Array {
    return fromBase64(ExpoWalletCore.privateKeyData(this._handle))
  }

  getPublicKeySecp256k1(compressed: boolean): NativePublicKey {
    const handle = ExpoWalletCore.privateKeyGetPublicKeySecp256k1(this._handle, compressed)
    return new NativePublicKey(handle)
  }

  getPublicKeyEd25519(): NativePublicKey {
    const handle = ExpoWalletCore.privateKeyGetPublicKeyEd25519(this._handle)
    return new NativePublicKey(handle)
  }

  delete(): void {
    ExpoWalletCore.freePrivateKey(this._handle)
  }
}

// ---------------------------------------------------------------------------
// NativeHDWallet — wraps a native handle
// ---------------------------------------------------------------------------

class NativeHDWallet {
  readonly _handle: number

  constructor(handle: number) {
    this._handle = handle
  }

  getMasterKey(curve: number): NativePrivateKey {
    const handle = ExpoWalletCore.hdWalletGetMasterKey(this._handle, curve)
    return new NativePrivateKey(handle)
  }

  getKeyForCoin(coinType: number): NativePrivateKey {
    const handle = ExpoWalletCore.hdWalletGetKeyForCoin(this._handle, coinType)
    return new NativePrivateKey(handle)
  }

  getKey(coinType: number, derivationPath: string): NativePrivateKey {
    const handle = ExpoWalletCore.hdWalletGetKey(this._handle, coinType, derivationPath)
    return new NativePrivateKey(handle)
  }

  getAddressForCoin(coinType: number): string {
    return ExpoWalletCore.hdWalletGetAddressForCoin(this._handle, coinType)
  }

  getExtendedPrivateKey(purpose: number, coinType: number, version: number): string {
    return ExpoWalletCore.hdWalletGetExtendedPrivateKey(this._handle, purpose, coinType, version)
  }

  getPublicKeyEd25519(): NativePublicKey {
    // Get master key for ed25519 curve, then extract public key
    const masterKey = this.getMasterKey(CurveValues.ed25519)
    const pubKey = masterKey.getPublicKeyEd25519()
    masterKey.delete()
    return pubKey
  }

  delete(): void {
    ExpoWalletCore.freeHDWallet(this._handle)
  }
}

// ---------------------------------------------------------------------------
// NativeDataVector — wraps signature/pubkey arrays
// ---------------------------------------------------------------------------

class NativeDataVector {
  readonly items: string[] = [] // base64 items

  add(data: Uint8Array): void {
    this.items.push(toBase64(data))
  }
}

// ---------------------------------------------------------------------------
// NativeAnyAddress — wraps address results
// ---------------------------------------------------------------------------

class NativeAnyAddress {
  private _description: string
  private _data: string | null

  constructor(description: string, data: string | null = null) {
    this._description = description
    this._data = data
  }

  description(): string {
    return this._description
  }

  data(): Uint8Array {
    if (this._data) {
      return fromBase64(this._data)
    }
    return new Uint8Array(0)
  }
}

// ---------------------------------------------------------------------------
// NativeWalletCore — the main facade
// ---------------------------------------------------------------------------

export class NativeWalletCore {
  private static instance: any = null

  static getInstance(): any {
    if (NativeWalletCore.instance) {
      return NativeWalletCore.instance
    }

    const wc: any = {
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
