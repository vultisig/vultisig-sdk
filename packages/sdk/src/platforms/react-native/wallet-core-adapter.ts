/**
 * WalletCore adapter for React Native
 *
 * Wraps @vultisig/expo-wallet-core's flat native API into a WalletCore-shaped
 * object that matches the @trustwallet/wallet-core WASM API used by the SDK's
 * core code.
 *
 * The SDK accesses walletCore.HDWallet.createWithMnemonic(...),
 * walletCore.CoinType.bitcoin, walletCore.PublicKey.createWithData(...), etc.
 * This adapter provides those same nested objects backed by native module calls.
 */
// Lazy import — don't call requireNativeModule until actually needed
let _expoWalletCore: any = null
function getExpoWalletCore(): any {
  if (!_expoWalletCore) {
    // Dynamic require to avoid eager module initialization
    _expoWalletCore = require('@vultisig/expo-wallet-core').default
  }
  return _expoWalletCore
}

// Cache coin types on first access
let coinTypeCache: Record<string, number> | null = null
function getCoinTypes(): Record<string, number> {
  if (!coinTypeCache) {
    coinTypeCache = getExpoWalletCore().getCoinTypes()
  }
  return coinTypeCache
}

// PublicKeyType constants (match TrustWallet's enum values)
const PublicKeyTypeValues = {
  secp256k1: 0,
  secp256k1Extended: 1,
  nist256p1: 2,
  nist256p1Extended: 3,
  ed25519: 4,
  ed25519Blake2b: 5,
  ed25519Cardano: 6,
  curve25519: 7,
  ed25519ExtendedCardano: 8,
} as const

// Purpose constants
const PurposeValues = {
  bip44: 44,
  bip49: 49,
  bip84: 84,
  bip1852: 1852,
} as const

// HDVersion constants
const HDVersionValues = {
  xprv: 0x0488ADE4,
  xpub: 0x0488B21E,
  yprv: 0x049D7878,
  ypub: 0x049D7CB2,
  zprv: 0x04B2430C,
  zpub: 0x04B24746,
} as const

// Curve constants
const CurveValues = {
  secp256k1: 'secp256k1',
  ed25519: 'ed25519',
  ed25519Blake2bNano: 'ed25519Blake2bNano',
  curve25519: 'curve25519',
  nist256p1: 'nist256p1',
} as const

/** Creates a WalletCore-shaped object backed by native module calls */
export function createNativeWalletCore(): any {
  const coinTypes = getCoinTypes()

  // Build CoinType object with both named constants and utility methods
  const CoinType: any = {}
  for (const [key, value] of Object.entries(coinTypes)) {
    CoinType[key] = value
  }

  // CoinTypeExt static methods
  const CoinTypeExt = {
    deriveAddressFromPublicKey(coinType: number, publicKey: any): string {
      const pkHex =
        typeof publicKey === 'object' && publicKey._dataHex
          ? publicKey._dataHex
          : publicKey
      const pkType =
        typeof publicKey === 'object' && publicKey._keyType !== undefined
          ? publicKey._keyType
          : PublicKeyTypeValues.secp256k1
      return getExpoWalletCore().coinTypeDeriveAddressFromPublicKey(
        coinType,
        pkHex,
        pkType
      )
    },
    derivationPath(coinType: number): string {
      return getExpoWalletCore().coinTypeDerivationPath(coinType)
    },
    chainId(coinType: number): string {
      return getExpoWalletCore().coinTypeChainId(coinType)
    },
    ss58Prefix(coinType: number): number {
      return getExpoWalletCore().coinTypeSs58Prefix(coinType)
    },
  }

  // PrivateKey wrapper
  class NativePrivateKey {
    private _dataHex: string

    constructor(dataHex: string) {
      this._dataHex = dataHex
    }

    data(): Uint8Array {
      return Buffer.from(this._dataHex, 'hex')
    }

    getPublicKeySecp256k1(compressed: boolean): NativePublicKey {
      const hex = getExpoWalletCore().privateKeyGetPublicKeySecp256k1(
        this._dataHex,
        compressed
      )
      return new NativePublicKey(hex, PublicKeyTypeValues.secp256k1)
    }

    getPublicKeyEd25519(): NativePublicKey {
      const hex = getExpoWalletCore().privateKeyGetPublicKeyEd25519(this._dataHex)
      return new NativePublicKey(hex, PublicKeyTypeValues.ed25519)
    }

    getPublicKeyEd25519Cardano(): NativePublicKey {
      const hex = getExpoWalletCore().privateKeyGetPublicKeyEd25519Cardano(
        this._dataHex
      )
      return new NativePublicKey(hex, PublicKeyTypeValues.ed25519Cardano)
    }

    delete(): void {
      this._dataHex = ''
    }
  }

  // PublicKey wrapper
  class NativePublicKey {
    _dataHex: string
    _keyType: number
    private _handle: number | null = null

    constructor(dataHex: string, keyType: number) {
      this._dataHex = dataHex
      this._keyType = keyType
    }

    private ensureHandle(): number {
      if (this._handle === null) {
        this._handle = getExpoWalletCore().createPublicKey(
          this._dataHex,
          this._keyType
        )
      }
      return this._handle
    }

    data(): Uint8Array {
      return Buffer.from(this._dataHex, 'hex')
    }

    uncompressed(): NativePublicKey {
      this.ensureHandle()
      const hex = getExpoWalletCore().publicKeyUncompressed(this._handle!)
      return new NativePublicKey(hex, this._keyType)
    }

    delete(): void {
      if (this._handle !== null) {
        getExpoWalletCore().publicKeyDelete(this._handle)
        this._handle = null
      }
    }
  }

  // HDWallet wrapper
  class NativeHDWallet {
    private _handle: number

    constructor(handle: number) {
      this._handle = handle
    }

    getMasterKey(curve: string): NativePrivateKey {
      const hex = getExpoWalletCore().hdWalletGetMasterKey(this._handle, curve)
      return new NativePrivateKey(hex)
    }

    getKeyForCoin(coin: number): NativePrivateKey {
      const hex = getExpoWalletCore().hdWalletGetKeyForCoin(this._handle, coin)
      return new NativePrivateKey(hex)
    }

    getKey(coin: number, derivationPath: string): NativePrivateKey {
      const hex = getExpoWalletCore().hdWalletGetKey(
        this._handle,
        coin,
        derivationPath
      )
      return new NativePrivateKey(hex)
    }

    getAddressForCoin(coin: number): string {
      return getExpoWalletCore().hdWalletGetAddressForCoin(this._handle, coin)
    }

    getExtendedPrivateKey(
      purpose: number,
      coin: number,
      version: number
    ): string {
      return getExpoWalletCore().hdWalletGetExtendedPrivateKey(
        this._handle,
        purpose,
        coin,
        version
      )
    }

    delete(): void {
      getExpoWalletCore().hdWalletDelete(this._handle)
    }
  }

  // AnyAddress wrapper
  const AnyAddress = {
    isValid(address: string, coinType: number): boolean {
      return getExpoWalletCore().anyAddressIsValid(address, coinType)
    },
    isValidBech32(address: string, coinType: number, hrp: string): boolean {
      return getExpoWalletCore().anyAddressIsValidBech32(address, coinType, hrp)
    },
    createWithString(
      address: string,
      coinType: number
    ): { data(): Uint8Array } | null {
      const hex = getExpoWalletCore().anyAddressCreateWithString(address, coinType)
      if (!hex) return null
      return { data: () => Buffer.from(hex, 'hex') }
    },
    createBech32(
      address: string,
      coinType: number,
      hrp: string
    ): { data(): Uint8Array } | null {
      const hex = getExpoWalletCore().anyAddressCreateBech32(
        address,
        coinType,
        hrp
      )
      if (!hex) return null
      return { data: () => Buffer.from(hex, 'hex') }
    },
    createBech32WithPublicKey(
      publicKey: any,
      coinType: number,
      hrp: string
    ): { description: string } | null {
      const pkHex =
        typeof publicKey === 'object' && publicKey._dataHex
          ? publicKey._dataHex
          : publicKey
      const pkType =
        typeof publicKey === 'object' && publicKey._keyType !== undefined
          ? publicKey._keyType
          : PublicKeyTypeValues.secp256k1
      const desc = getExpoWalletCore().anyAddressCreateBech32WithPublicKey(
        pkHex,
        pkType,
        coinType,
        hrp
      )
      return { description: desc }
    },
  }

  // HexCoding wrapper
  const HexCoding = {
    decode(hexString: string): Uint8Array {
      return Buffer.from(hexString, 'hex')
    },
    encode(data: Uint8Array): string {
      return Buffer.from(data).toString('hex')
    },
  }

  // Bech32 wrapper
  const Bech32 = {
    encode(hrp: string, data: Uint8Array): string {
      const dataHex = Buffer.from(data).toString('hex')
      return getExpoWalletCore().bech32Encode(hrp, dataHex)
    },
  }

  // DataVector — collects Uint8Array items, passes them as base64 arrays to native
  const DataVector = {
    create(): { add(data: Uint8Array): void; _items: Uint8Array[] } {
      const items: Uint8Array[] = []
      return {
        _items: items,
        add(data: Uint8Array) {
          items.push(data)
        },
      }
    },
  }

  // TransactionCompiler
  const TransactionCompiler = {
    preImageHashes(coinType: number, txInputData: Uint8Array): Uint8Array {
      const inputB64 = Buffer.from(txInputData).toString('base64')
      const resultB64 = getExpoWalletCore().transactionCompilerPreImageHashes(coinType, inputB64)
      return new Uint8Array(Buffer.from(resultB64, 'base64'))
    },
    compileWithSignatures(
      coinType: number,
      txInputData: Uint8Array,
      signatures: { _items: Uint8Array[] },
      publicKeys: { _items: Uint8Array[] }
    ): Uint8Array {
      const inputB64 = Buffer.from(txInputData).toString('base64')
      const sigsB64 = signatures._items.map(s => Buffer.from(s).toString('base64'))
      const pksB64 = publicKeys._items.map(p => Buffer.from(p).toString('base64'))
      const resultB64 = getExpoWalletCore().transactionCompilerCompileWithSignatures(
        coinType, inputB64, sigsB64, pksB64
      )
      return new Uint8Array(Buffer.from(resultB64, 'base64'))
    },
  }

  // AnySigner
  const AnySigner = {
    plan(inputData: Uint8Array, coinType: number): Uint8Array {
      const inputB64 = Buffer.from(inputData).toString('base64')
      const resultB64 = getExpoWalletCore().anySignerPlan(inputB64, coinType)
      return new Uint8Array(Buffer.from(resultB64, 'base64'))
    },
  }

  // TransactionDecoder
  const TransactionDecoder = {
    decode(coinType: number, data: Uint8Array): Uint8Array {
      const dataB64 = Buffer.from(data).toString('base64')
      const resultB64 = getExpoWalletCore().transactionDecoderDecode(coinType, dataB64)
      return new Uint8Array(Buffer.from(resultB64, 'base64'))
    },
  }

  // BitcoinScript
  const BitcoinScript = {
    lockScriptForAddress(address: string, coinType: number): { data(): Uint8Array; matchPayToWitnessPublicKeyHash(): Uint8Array | null; matchPayToPubkeyHash(): Uint8Array | null } {
      const scriptB64 = getExpoWalletCore().bitcoinScriptLockScriptForAddress(address, coinType)
      const scriptData = new Uint8Array(Buffer.from(scriptB64, 'base64'))
      return {
        data: () => scriptData,
        matchPayToWitnessPublicKeyHash(): Uint8Array | null {
          const result = getExpoWalletCore().bitcoinScriptMatchPayToWitnessPublicKeyHash(scriptB64)
          return result ? new Uint8Array(Buffer.from(result, 'base64')) : null
        },
        matchPayToPubkeyHash(): Uint8Array | null {
          const result = getExpoWalletCore().bitcoinScriptMatchPayToPublicKeyHash(scriptB64)
          return result ? new Uint8Array(Buffer.from(result, 'base64')) : null
        },
      }
    },
    buildPayToWitnessPubkeyHash(hash: Uint8Array): { data(): Uint8Array } {
      const hashB64 = Buffer.from(hash).toString('base64')
      const resultB64 = getExpoWalletCore().bitcoinScriptBuildPayToWitnessPubkeyHash(hashB64)
      return { data: () => new Uint8Array(Buffer.from(resultB64, 'base64')) }
    },
    buildPayToPublicKeyHash(hash: Uint8Array): { data(): Uint8Array } {
      const hashB64 = Buffer.from(hash).toString('base64')
      const resultB64 = getExpoWalletCore().bitcoinScriptBuildPayToPublicKeyHash(hashB64)
      return { data: () => new Uint8Array(Buffer.from(resultB64, 'base64')) }
    },
    hashTypeForCoin(coinType: number): number {
      return getExpoWalletCore().bitcoinScriptHashTypeForCoin(coinType)
    },
  }

  // EthereumAbi
  const EthereumAbiFunction = {
    createWithString(name: string): any {
      const params: Array<{ type: string; value: string }> = []
      return {
        _name: name,
        _params: params,
        addParamAddress(val: Uint8Array, isOutput: boolean) {
          if (!isOutput) params.push({ type: 'address', value: Buffer.from(val).toString('hex') })
          return params.length - 1
        },
        addParamUInt256(val: Uint8Array, isOutput: boolean) {
          if (!isOutput) params.push({ type: 'uint256', value: Buffer.from(val).toString('hex') })
          return params.length - 1
        },
        addParamUInt64(val: number, isOutput: boolean) {
          if (!isOutput) params.push({ type: 'uint64', value: String(val) })
          return params.length - 1
        },
        addParamBool(val: boolean, isOutput: boolean) {
          if (!isOutput) params.push({ type: 'bool', value: String(val) })
          return params.length - 1
        },
        addParamString(val: string, isOutput: boolean) {
          if (!isOutput) params.push({ type: 'string', value: val })
          return params.length - 1
        },
        addParamBytes(val: Uint8Array, isOutput: boolean) {
          if (!isOutput) params.push({ type: 'bytes', value: Buffer.from(val).toString('hex') })
          return params.length - 1
        },
      }
    },
  }

  const EthereumAbi = {
    encode(fn: any): Uint8Array {
      const hex = getExpoWalletCore().ethereumAbiEncode(fn._name, fn._params)
      return Buffer.from(hex, 'hex')
    },
  }

  // TONAddressConverter
  const TONAddressConverter = {
    toUserFriendly(address: string, bounceable: boolean, testOnly: boolean): string {
      return getExpoWalletCore().tonAddressToUserFriendly(address, bounceable, testOnly)
    },
  }

  // SolanaAddress
  const SolanaAddress = {
    createWithString(address: string): { description: string } {
      const desc = getExpoWalletCore().solanaAddressCreateWithString(address)
      return { description: desc }
    },
  }

  return {
    HDWallet: {
      createWithMnemonic(
        mnemonic: string,
        passphrase: string
      ): NativeHDWallet {
        const handle = getExpoWalletCore().createHDWallet(mnemonic, passphrase)
        return new NativeHDWallet(handle)
      },
    },
    CoinType,
    CoinTypeExt,
    PublicKey: {
      createWithData(data: Uint8Array, keyType: number): NativePublicKey {
        const hex = Buffer.from(data).toString('hex')
        return new NativePublicKey(hex, keyType)
      },
    },
    PublicKeyType: PublicKeyTypeValues,
    Curve: CurveValues,
    Purpose: PurposeValues,
    HDVersion: HDVersionValues,
    AnyAddress,
    HexCoding,
    Bech32,
    DataVector,
    TransactionCompiler,
    TransactionDecoder,
    AnySigner,
    BitcoinScript,
    EthereumAbiFunction,
    EthereumAbi,
    TONAddressConverter,
    SolanaAddress,
  }
}
