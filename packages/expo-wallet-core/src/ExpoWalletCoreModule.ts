import { NativeModule, requireNativeModule } from 'expo'

declare class ExpoWalletCoreModule extends NativeModule {
  // === HDWallet ===
  /** Create HDWallet from mnemonic, returns handle */
  createHDWallet(mnemonic: string, passphrase: string): number
  /** Get master key for curve ('secp256k1' | 'ed25519'), returns private key hex */
  hdWalletGetMasterKey(walletHandle: number, curve: string): string
  /** Get key for coin type, returns private key hex */
  hdWalletGetKeyForCoin(walletHandle: number, coinType: number): string
  /** Get key for coin with custom derivation path, returns private key hex */
  hdWalletGetKey(walletHandle: number, coinType: number, derivationPath: string): string
  /** Get address for coin type */
  hdWalletGetAddressForCoin(walletHandle: number, coinType: number): string
  /** Get extended private key */
  hdWalletGetExtendedPrivateKey(walletHandle: number, purpose: number, coinType: number, version: number): string
  /** Delete/free wallet handle */
  hdWalletDelete(walletHandle: number): void

  // === PublicKey ===
  /** Create public key from data, returns handle. keyType: 0=secp256k1, 1=ed25519, 6=ed25519Cardano */
  createPublicKey(dataHex: string, keyType: number): number
  /** Get public key data as hex */
  publicKeyData(handle: number): string
  /** Get uncompressed public key data as hex */
  publicKeyUncompressed(handle: number): string
  /** Free public key handle */
  publicKeyDelete(handle: number): void

  // === PrivateKey (from HDWallet) ===
  /** Get secp256k1 public key from private key hex, compressed */
  privateKeyGetPublicKeySecp256k1(privateKeyHex: string, compressed: boolean): string
  /** Get ed25519 public key from private key hex */
  privateKeyGetPublicKeyEd25519(privateKeyHex: string): string
  /** Get ed25519 Cardano public key from private key hex */
  privateKeyGetPublicKeyEd25519Cardano(privateKeyHex: string): string

  // === CoinType ===
  /** Derive address from public key hex for coin type */
  coinTypeDeriveAddressFromPublicKey(coinType: number, publicKeyHex: string, publicKeyType: number): string
  /** Get standard derivation path for coin type */
  coinTypeDerivationPath(coinType: number): string
  /** Get chain ID for coin type */
  coinTypeChainId(coinType: number): string
  /** Get SS58 prefix for coin type (Polkadot) */
  coinTypeSs58Prefix(coinType: number): number

  // === AnyAddress ===
  /** Validate address for coin type */
  anyAddressIsValid(address: string, coinType: number): boolean
  /** Validate bech32 address with HRP */
  anyAddressIsValidBech32(address: string, coinType: number, hrp: string): boolean
  /** Create address data from string, returns hex */
  anyAddressCreateWithString(address: string, coinType: number): string | null
  /** Create bech32 address data with HRP, returns hex */
  anyAddressCreateBech32(address: string, coinType: number, hrp: string): string | null
  /** Derive bech32 address from public key hex with HRP */
  anyAddressCreateBech32WithPublicKey(publicKeyHex: string, publicKeyType: number, coinType: number, hrp: string): string

  // === HexCoding ===
  /** Decode hex to bytes (returns base64) */
  hexDecode(hexString: string): string
  /** Encode bytes (from base64) to hex */
  hexEncode(base64Data: string): string

  // === Bech32 ===
  /** Encode bech32 */
  bech32Encode(hrp: string, dataHex: string): string

  // === TransactionCompiler (Phase 2) ===
  /** Get pre-image hashes for signing. Input/output are base64-encoded protobuf bytes. */
  transactionCompilerPreImageHashes(coinType: number, txInputBase64: string): string
  /** Compile transaction with signatures. All byte arrays are base64-encoded. */
  transactionCompilerCompileWithSignatures(
    coinType: number,
    txInputBase64: string,
    signaturesBase64: string[],
    publicKeysBase64: string[]
  ): string

  // === AnySigner (Phase 2) ===
  /** Plan a transaction (UTXO fee estimation). Input/output are base64. */
  anySignerPlan(txInputBase64: string, coinType: number): string

  // === TransactionDecoder (Phase 2) ===
  /** Decode a transaction. Input/output are base64. */
  transactionDecoderDecode(coinType: number, txDataBase64: string): string

  // === BitcoinScript (Phase 2) ===
  /** Get lock script for address, returns base64 */
  bitcoinScriptLockScriptForAddress(address: string, coinType: number): string
  /** Match P2WPKH from script, returns base64 or null */
  bitcoinScriptMatchPayToWitnessPublicKeyHash(scriptBase64: string): string | null
  /** Match P2PKH from script, returns base64 or null */
  bitcoinScriptMatchPayToPublicKeyHash(scriptBase64: string): string | null
  /** Build P2WPKH script from pubkey hash, returns base64 */
  bitcoinScriptBuildPayToWitnessPubkeyHash(pubKeyHashBase64: string): string
  /** Build P2PKH script from pubkey hash, returns base64 */
  bitcoinScriptBuildPayToPublicKeyHash(pubKeyHashBase64: string): string
  /** Get hash type for coin */
  bitcoinScriptHashTypeForCoin(coinType: number): number

  // === EthereumAbi (Phase 2) ===
  /** Encode an Ethereum ABI function call. Returns hex-encoded data. */
  ethereumAbiEncode(
    functionName: string,
    params: Array<{ type: string; value: string }>
  ): string

  // === TONAddressConverter (Phase 2) ===
  /** Convert TON address to user-friendly format */
  tonAddressToUserFriendly(address: string, bounceable: boolean, testOnly: boolean): string

  // === SolanaAddress (Phase 2) ===
  /** Create Solana address, returns description string */
  solanaAddressCreateWithString(address: string): string

  // === CoinType constants (returned as a map) ===
  getCoinTypes(): Record<string, number>
}

export default requireNativeModule<ExpoWalletCoreModule>('ExpoWalletCore')
