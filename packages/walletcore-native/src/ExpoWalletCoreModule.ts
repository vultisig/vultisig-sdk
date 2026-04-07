import { requireNativeModule } from 'expo-modules-core'

/**
 * TypeScript declarations for the ExpoWalletCore native module.
 *
 * Uses handle-based opaque references for objects (PublicKey, HDWallet, etc.).
 * Callers must free handles explicitly via the corresponding free* methods.
 */

interface ExpoWalletCoreModuleType {
  // ---------------------------------------------------------------------------
  // CoinType — enum values
  // ---------------------------------------------------------------------------

  /** Get the numeric CoinType value for a coin name. */
  coinTypeValue(name: string): number

  // ---------------------------------------------------------------------------
  // CoinTypeExt — static methods on CoinType
  // ---------------------------------------------------------------------------

  /** Get the default derivation path for a CoinType. */
  derivationPath(coinType: number): string

  /** Derive an address from a public key handle for a CoinType. */
  deriveAddressFromPublicKey(coinType: number, publicKeyHandle: number): string

  /** Get the chain ID for a CoinType (EVM chains). */
  chainId(coinType: number): string

  /** Get the SS58 address prefix for a CoinType. */
  ss58Prefix(coinType: number): number

  // ---------------------------------------------------------------------------
  // PublicKey
  // ---------------------------------------------------------------------------

  /** Create a PublicKey from raw bytes. Returns a handle. */
  publicKeyCreateWithData(dataBase64: string, typeValue: number): number

  /** Get the raw public key bytes. Returns base64. */
  publicKeyData(handle: number): string

  /** Get the uncompressed public key. Returns a new handle. */
  publicKeyUncompressed(handle: number): number

  /** Get the compressed public key. Returns a new handle. */
  publicKeyCompressed(handle: number): number

  /** Verify a signature with this public key. */
  publicKeyVerify(handle: number, signatureBase64: string, messageBase64: string): boolean

  /** Verify a DER-encoded signature. */
  publicKeyVerifyAsDER(handle: number, signatureBase64: string, messageBase64: string): boolean

  /** Free a PublicKey handle. */
  freePublicKey(handle: number): void

  // ---------------------------------------------------------------------------
  // AnyAddress
  // ---------------------------------------------------------------------------

  /** Check if an address is valid for a CoinType. */
  anyAddressIsValid(address: string, coinType: number): boolean

  /** Check if a Bech32 address is valid. */
  anyAddressIsValidBech32(address: string, coinType: number, hrp: string): boolean

  /** Check if an SS58 address is valid. */
  anyAddressIsValidSS58(address: string, coinType: number, ss58Prefix: number): boolean

  /** Create an AnyAddress from a string. Returns the description (formatted address). */
  anyAddressCreateWithString(address: string, coinType: number): string

  /** Create a Bech32 address from a public key. Returns the description string. */
  anyAddressCreateBech32WithPublicKey(publicKeyHandle: number, coinType: number, hrp: string): string

  /** Create a Bech32 address from a string address. Returns the description string. */
  anyAddressCreateBech32(address: string, coinType: number, hrp: string): string

  /** Get the raw data of an address. Returns base64. */
  anyAddressData(address: string, coinType: number): string

  // ---------------------------------------------------------------------------
  // TransactionCompiler
  // ---------------------------------------------------------------------------

  /** Get the pre-image hashes for a transaction. Returns base64-encoded proto. */
  preImageHashes(coinType: number, txInputDataBase64: string): string

  /** Compile a transaction with signatures. Returns base64-encoded compiled tx. */
  compileWithSignatures(
    coinType: number,
    txInputDataBase64: string,
    signaturesBase64: string[],
    publicKeysBase64: string[]
  ): string

  // ---------------------------------------------------------------------------
  // AnySigner
  // ---------------------------------------------------------------------------

  /** Plan a transaction. Returns base64-encoded plan proto. */
  anySignerPlan(txInputDataBase64: string, coinType: number): string

  // ---------------------------------------------------------------------------
  // HDWallet
  // ---------------------------------------------------------------------------

  /** Create an HDWallet from a mnemonic. Returns a handle. */
  hdWalletCreate(mnemonic: string, passphrase: string): number

  /** Get the master key for a curve. Returns a PrivateKey handle. */
  hdWalletGetMasterKey(handle: number, curveValue: number): number

  /** Get the key for a specific coin. Returns a PrivateKey handle. */
  hdWalletGetKeyForCoin(handle: number, coinType: number): number

  /** Get a key with a specific Derivation enum value. Returns a PrivateKey handle. */
  hdWalletGetKeyDerivation(handle: number, coinType: number, derivationValue: number): number

  /** Get address with a specific Derivation enum value. */
  hdWalletGetAddressDerivation(handle: number, coinType: number, derivationValue: number): string

  /** Get a key for a specific derivation path. Returns a PrivateKey handle. */
  hdWalletGetKey(handle: number, coinType: number, derivationPath: string): number

  /** Get the default address for a coin. */
  hdWalletGetAddressForCoin(handle: number, coinType: number): string

  /** Get the extended private key. */
  hdWalletGetExtendedPrivateKey(
    handle: number,
    purposeValue: number,
    coinType: number,
    versionValue: number
  ): string

  /** Free an HDWallet handle. */
  freeHDWallet(handle: number): void

  // ---------------------------------------------------------------------------
  // PrivateKey
  // ---------------------------------------------------------------------------

  /** Create a random PrivateKey. Returns a handle. */
  privateKeyCreate(): number

  /** Get raw private key bytes. Returns base64. */
  privateKeyData(handle: number): string

  /** Get secp256k1 public key. Returns a PublicKey handle. */
  privateKeyGetPublicKeySecp256k1(handle: number, compressed: boolean): number

  /** Get ed25519 public key. Returns a PublicKey handle. */
  privateKeyGetPublicKeyEd25519(handle: number): number

  /** Free a PrivateKey handle. */
  freePrivateKey(handle: number): void

  // ---------------------------------------------------------------------------
  // HexCoding
  // ---------------------------------------------------------------------------

  /** Decode a hex string to bytes. Returns base64. */
  hexDecode(hex: string): string

  /** Encode bytes to hex. */
  hexEncode(dataBase64: string): string

  // ---------------------------------------------------------------------------
  // Bech32
  // ---------------------------------------------------------------------------

  /** Encode data with Bech32. */
  bech32Encode(hrp: string, dataBase64: string): string

  // ---------------------------------------------------------------------------
  // BitcoinScript
  // ---------------------------------------------------------------------------

  /** Build a P2WPKH script. Returns base64. */
  bitcoinScriptBuildPayToWitnessPubkeyHash(hashBase64: string): string

  /** Build a P2PKH script. Returns base64. */
  bitcoinScriptBuildPayToPublicKeyHash(hashBase64: string): string

  /** Get the lock script for an address. Returns base64. */
  bitcoinScriptLockScriptForAddress(address: string, coinType: number): string

  /** Get the hash type for a coin. */
  bitcoinScriptHashTypeForCoin(coinType: number): number

  // ---------------------------------------------------------------------------
  // EthereumAbi
  // ---------------------------------------------------------------------------

  /** Encode an ABI function call. Returns base64. */
  ethereumAbiEncode(functionName: string, params: string): string

  /** Encode a typed data message (EIP-712). Returns hex string. */
  ethereumAbiEncodeTyped(messageJson: string): string

  // ---------------------------------------------------------------------------
  // Mnemonic
  // ---------------------------------------------------------------------------

  /** Check if a mnemonic phrase is valid. */
  mnemonicIsValid(mnemonic: string): boolean

  // ---------------------------------------------------------------------------
  // TONAddressConverter
  // ---------------------------------------------------------------------------

  /** Convert a TON address to user-friendly format. */
  tonAddressToUserFriendly(address: string): string

  // ---------------------------------------------------------------------------
  // SolanaAddress
  // ---------------------------------------------------------------------------

  /** Get the default token address for a Solana address + token mint. */
  solanaAddressDefaultTokenAddress(address: string, tokenMintAddress: string): string
}

export default requireNativeModule<ExpoWalletCoreModuleType>('ExpoWalletCore')
