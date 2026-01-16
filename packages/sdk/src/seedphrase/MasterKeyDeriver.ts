/**
 * MasterKeyDeriver - Extracts master keys from BIP39 mnemonic
 *
 * Derives ECDSA (secp256k1) and EdDSA (ed25519) master keys from a mnemonic
 * for use in TSS key import. Mirrors the iOS/Windows implementation.
 */
import type { Chain } from '@core/chain/Chain'
import { getChainKind } from '@core/chain/ChainKind'
import { signatureAlgorithms } from '@core/chain/signing/SignatureAlgorithm'

import type { WasmProvider } from '../context/SdkContext'
import { clampThenUniformScalar } from '../crypto/ed25519ScalarClamp'
import { cleanMnemonic } from './SeedphraseValidator'
import type { DerivedMasterKeys } from './types'

/**
 * Result from deriving a chain-specific private key for MPC import
 */
export type ChainPrivateKey = {
  /** Chain this key is for */
  chain: Chain
  /** Private key as hex string (clamped for EdDSA chains) */
  privateKeyHex: string
  /** Whether this is an EdDSA key */
  isEddsa: boolean
}

/**
 * Result from deriving a chain-specific key
 */
export type DerivedChainKey = {
  /** Chain this key is for */
  chain: Chain
  /** Private key as hex string */
  privateKeyHex: string
  /** Public key as hex string */
  publicKeyHex: string
  /** Derived address for this chain */
  address: string
  /** Whether this is an EdDSA key (requires clamping) */
  isEddsa: boolean
}

/**
 * MasterKeyDeriver - Derives cryptographic keys from BIP39 mnemonic
 *
 * Uses WalletCore's HDWallet to derive:
 * - ECDSA master key (secp256k1) for Bitcoin, Ethereum, etc.
 * - EdDSA master key (ed25519) for Solana, Sui, etc.
 * - Chain-specific keys using BIP44 derivation paths
 *
 * @example
 * ```typescript
 * const deriver = new MasterKeyDeriver(wasmProvider)
 * const keys = await deriver.deriveMasterKeys(mnemonic)
 * console.log(keys.ecdsaPrivateKeyHex) // For DKLS import
 * console.log(keys.eddsaPrivateKeyHex) // For Schnorr import (already clamped)
 * ```
 */
export class MasterKeyDeriver {
  constructor(private readonly wasmProvider: WasmProvider) {}

  /**
   * Derive master keys from a mnemonic
   *
   * @param mnemonic - BIP39 mnemonic phrase (12 or 24 words)
   * @returns Master keys for ECDSA and EdDSA, plus chain code
   */
  async deriveMasterKeys(mnemonic: string): Promise<DerivedMasterKeys> {
    const walletCore = await this.wasmProvider.getWalletCore()
    const cleaned = cleanMnemonic(mnemonic)

    // Create HDWallet with empty passphrase (matching iOS behavior)
    const hdWallet = walletCore.HDWallet.createWithMnemonic(cleaned, '')

    try {
      // Extract ECDSA master key (secp256k1)
      const ecdsaMasterKey = hdWallet.getMasterKey(walletCore.Curve.secp256k1)
      const ecdsaPrivateKeyHex = Buffer.from(ecdsaMasterKey.data()).toString('hex')

      // Extract EdDSA master key (ed25519) and apply clamping transformation
      const eddsaMasterKey = hdWallet.getMasterKey(walletCore.Curve.ed25519)
      const eddsaMasterKeyData = new Uint8Array(eddsaMasterKey.data())
      const clampedEddsaKey = clampThenUniformScalar(eddsaMasterKeyData)
      const eddsaPrivateKeyHex = Buffer.from(clampedEddsaKey).toString('hex')

      // Chain code will be obtained from the DKLS key import result
      // For now, we derive it from the wallet seed using standard BIP32
      // Note: The actual chain code used in vaults comes from DKLS result
      const chainCodeHex = this.deriveChainCode(hdWallet, walletCore)

      return {
        ecdsaPrivateKeyHex,
        eddsaPrivateKeyHex,
        chainCodeHex,
      }
    } finally {
      // Clean up HDWallet to minimize memory exposure
      // Note: JavaScript doesn't guarantee memory zeroing, but we try
      if (hdWallet.delete) {
        hdWallet.delete()
      }
    }
  }

  /**
   * Derive a chain-specific key from mnemonic
   *
   * @param mnemonic - BIP39 mnemonic phrase
   * @param chain - Target blockchain
   * @param isEddsa - Whether this chain uses EdDSA (Solana, Sui, etc.)
   * @returns Chain-specific key information
   */
  async deriveChainKey(mnemonic: string, chain: Chain, isEddsa: boolean): Promise<DerivedChainKey> {
    const walletCore = await this.wasmProvider.getWalletCore()
    const cleaned = cleanMnemonic(mnemonic)

    const hdWallet = walletCore.HDWallet.createWithMnemonic(cleaned, '')

    try {
      // Get coin type for this chain
      const coinType = this.getCoinType(chain, walletCore)

      // Derive chain-specific key
      const chainKey = hdWallet.getKeyForCoin(coinType)
      const chainKeyData = new Uint8Array(chainKey.data())

      let privateKeyHex: string
      if (isEddsa) {
        // EdDSA keys require clamping transformation
        const clampedKey = clampThenUniformScalar(chainKeyData)
        privateKeyHex = Buffer.from(clampedKey).toString('hex')
      } else {
        privateKeyHex = Buffer.from(chainKeyData).toString('hex')
      }

      // Get public key and address
      // EdDSA chains use ed25519 public keys, ECDSA chains use secp256k1
      const publicKey = isEddsa
        ? chain === 'Cardano'
          ? chainKey.getPublicKeyEd25519Cardano()
          : chainKey.getPublicKeyEd25519()
        : chainKey.getPublicKeySecp256k1(true) // compressed
      const publicKeyHex = Buffer.from(publicKey.data()).toString('hex')
      const address = hdWallet.getAddressForCoin(coinType)

      return {
        chain,
        privateKeyHex,
        publicKeyHex,
        address,
        isEddsa,
      }
    } finally {
      if (hdWallet.delete) {
        hdWallet.delete()
      }
    }
  }

  /**
   * Derive private keys for multiple chains efficiently (single HDWallet creation)
   *
   * This is optimized for seedphrase import where we need to derive keys for
   * multiple chains in a single operation. Uses signatureAlgorithms to determine
   * whether each chain uses ECDSA or EdDSA.
   *
   * @param mnemonic - BIP39 mnemonic phrase
   * @param chains - Array of chains to derive keys for
   * @returns Array of chain private keys
   */
  async deriveChainPrivateKeys(mnemonic: string, chains: Chain[]): Promise<ChainPrivateKey[]> {
    const walletCore = await this.wasmProvider.getWalletCore()
    const cleaned = cleanMnemonic(mnemonic)

    const hdWallet = walletCore.HDWallet.createWithMnemonic(cleaned, '')

    try {
      const results: ChainPrivateKey[] = []

      for (const chain of chains) {
        const coinType = this.getCoinType(chain, walletCore)
        const chainKind = getChainKind(chain)
        const algorithm = signatureAlgorithms[chainKind]
        const isEddsa = algorithm === 'eddsa'

        // Derive chain-specific key
        const chainKey = hdWallet.getKeyForCoin(coinType)
        const chainKeyData = new Uint8Array(chainKey.data())

        let privateKeyHex: string
        if (isEddsa) {
          // EdDSA keys require clamping transformation
          const clampedKey = clampThenUniformScalar(chainKeyData)
          privateKeyHex = Buffer.from(clampedKey).toString('hex')
        } else {
          privateKeyHex = Buffer.from(chainKeyData).toString('hex')
        }

        results.push({
          chain,
          privateKeyHex,
          isEddsa,
        })
      }

      return results
    } finally {
      if (hdWallet.delete) {
        hdWallet.delete()
      }
    }
  }

  /**
   * Derive address for a chain without exposing the private key
   *
   * @param mnemonic - BIP39 mnemonic phrase
   * @param chain - Target blockchain
   * @returns Address for the chain
   */
  async deriveAddress(mnemonic: string, chain: Chain): Promise<string> {
    const walletCore = await this.wasmProvider.getWalletCore()
    const cleaned = cleanMnemonic(mnemonic)

    const hdWallet = walletCore.HDWallet.createWithMnemonic(cleaned, '')

    try {
      const coinType = this.getCoinType(chain, walletCore)

      // Special handling for MayaChain: derive with 'maya' prefix
      if (chain === 'MayaChain') {
        const publicKey = hdWallet.getKeyForCoin(coinType).getPublicKeySecp256k1(false)
        return walletCore.AnyAddress.createBech32WithPublicKey(publicKey, coinType, 'maya').description()
      }

      // Special handling for Sei: use Ethereum address for EVM RPC
      if (chain === 'Sei') {
        const ethCoinType = walletCore.CoinType.ethereum
        return hdWallet.getAddressForCoin(ethCoinType)
      }

      return hdWallet.getAddressForCoin(coinType)
    } finally {
      if (hdWallet.delete) {
        hdWallet.delete()
      }
    }
  }

  /**
   * Derive chain code from HDWallet
   * Uses the root chain code from the BIP32 derivation
   */
  private deriveChainCode(hdWallet: any, walletCore: any): string {
    // Get seed and derive chain code using BIP32 standard
    // The chain code is the last 32 bytes of HMAC-SHA512("Bitcoin seed", seed)
    // WalletCore handles this internally, we extract it from the extended key
    try {
      // Try to get chain code from Bitcoin derivation (m/44'/0'/0')
      const btcCoinType = walletCore.CoinType.bitcoin
      // Get extended key to verify derivation works
      // The actual chain code comes from DKLS keygen result
      hdWallet.getExtendedPrivateKey(walletCore.Purpose.bip44, btcCoinType, walletCore.HDVersion.xprv)

      // For now, return empty - the chain code is provided by DKLS keygen
      // This matches how vultisig-windows handles seedphrase import
      return ''
    } catch {
      return ''
    }
  }

  /**
   * Get WalletCore CoinType for a chain
   */
  private getCoinType(chain: Chain, walletCore: any): any {
    // Map chain names to WalletCore CoinType
    const chainToCoinType: Record<string, string> = {
      Bitcoin: 'bitcoin',
      Ethereum: 'ethereum',
      Solana: 'solana',
      Cosmos: 'cosmos',
      THORChain: 'thorchain',
      MayaChain: 'thorchain', // MayaChain uses THORChain cointype
      Litecoin: 'litecoin',
      Dogecoin: 'dogecoin',
      'Bitcoin-Cash': 'bitcoinCash',
      Dash: 'dash',
      Polygon: 'polygon',
      Arbitrum: 'arbitrum',
      Optimism: 'optimism',
      Base: 'base',
      Avalanche: 'avalancheCChain',
      BSC: 'smartChain',
      Sui: 'sui',
      Polkadot: 'polkadot',
      Ton: 'ton',
      Tron: 'tron',
      Ripple: 'xrp',
      Cardano: 'cardano',
      Dydx: 'dydx',
      Osmosis: 'osmosis',
      Kujira: 'kujira',
      Terra: 'terraV2',
      TerraClassic: 'terra',
      Noble: 'noble',
      Akash: 'akash',
      CronosChain: 'cronos',
      Blast: 'blast',
      Zksync: 'zksync',
      Mantle: 'mantle',
      Zcash: 'zcash',
      Sei: 'sei',
      Hyperliquid: 'ethereum', // Uses Ethereum derivation
    }

    const coinTypeName = chainToCoinType[chain]
    if (!coinTypeName) {
      throw new Error(`Unsupported chain: ${chain}`)
    }

    const coinType = walletCore.CoinType[coinTypeName]
    if (!coinType) {
      throw new Error(`CoinType not found for chain: ${chain}`)
    }

    return coinType
  }
}
