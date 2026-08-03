/**
 * Integration Test: Multi-Chain Address Derivation
 *
 * This test verifies that ALL supported chains can derive valid addresses
 * using the PUBLIC SDK API with REAL WASM modules.
 *
 * IMPORTANT: Uses ONLY public SDK API (Vultisig class)
 * This is a true integration test - testing the SDK as users would use it.
 *
 * Test Coverage:
 * - All 40+ blockchain chains
 * - Chain families: UTXO, EVM, Cosmos, EdDSA-based
 * - Address format validation
 * - Address caching behavior
 *
 * NOTE: Integration setup (WASM & crypto polyfills) loaded via vitest.config.ts
 */

import { create, toBinary } from '@bufbuild/protobuf'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { Chain } from '@vultisig/core-chain/Chain'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { VaultContainerSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_container_pb'
import { Vault_KeyShareSchema, VaultSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_pb'
import type { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'
import { bech32 } from 'bech32'
import BIP32Factory from 'bip32'
import * as bitcoin from 'bitcoinjs-lib'
import bs58 from 'bs58'
import * as ecc from 'tiny-secp256k1'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createSdkContext, type SdkContext } from '../../../src/context/SdkContextBuilder'
import { FastSigningService } from '../../../src/services/FastSigningService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { VaultData } from '../../../src/types'
import { FastVault } from '../../../src/vault/FastVault'
import { SecureVault } from '../../../src/vault/SecureVault'
import { Vultisig } from '../../../src/Vultisig'

/**
 * ALL SUPPORTED CHAINS
 * Extracted from Chain enum to test EVERY chain
 */
const ALL_CHAINS = Object.values(Chain)

console.log(`\n🔍 Testing ${ALL_CHAINS.length} blockchain chains\n`)

/**
 * Chain-specific address validators
 * Each chain has unique address format requirements
 */
const CHAIN_VALIDATORS: Record<string, (address: string) => boolean> = {
  // UTXO Chains
  Bitcoin: addr => /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr),
  Litecoin: addr => /^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr),
  Dogecoin: addr => /^D[a-zA-HJ-NP-Z0-9]{33}$/.test(addr),
  'Bitcoin-Cash': addr =>
    /^(bitcoincash:|q)[a-zA-HJ-NP-Z0-9]{40,45}$/.test(addr) || /^[13][a-zA-HJ-NP-Z0-9]{25,34}$/.test(addr),
  Dash: addr => /^X[a-zA-HJ-NP-Z0-9]{33}$/.test(addr),
  Zcash: addr => /^(t1|t3)[a-zA-HJ-NP-Z0-9]{33}$/.test(addr),

  // EVM Chains (all share same address format)
  Ethereum: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Polygon: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  BSC: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Avalanche: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  CronosChain: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Arbitrum: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Base: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Blast: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Optimism: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Zksync: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Mantle: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Robinhood: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),

  // Cosmos Chains
  Cosmos: addr => /^cosmos1[a-z0-9]{38,}$/.test(addr),
  THORChain: addr => /^thor1[a-z0-9]{38,}$/.test(addr),
  MayaChain: addr => /^maya1[a-z0-9]{38,}$/.test(addr),
  Osmosis: addr => /^osmo1[a-z0-9]{38,}$/.test(addr),
  Dydx: addr => /^dydx1[a-z0-9]{38,}$/.test(addr),
  Kujira: addr => /^kujira1[a-z0-9]{38,}$/.test(addr),
  Terra: addr => /^terra1[a-z0-9]{38,}$/.test(addr),
  TerraClassic: addr => /^terra1[a-z0-9]{38,}$/.test(addr),
  Noble: addr => /^noble1[a-z0-9]{38,}$/.test(addr),
  Akash: addr => /^akash1[a-z0-9]{38,}$/.test(addr),

  // EdDSA & Other Chains
  Solana: addr => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr),
  Sui: addr => /^0x[a-f0-9]{64}$/.test(addr),
  Polkadot: addr => /^1[a-zA-HJ-NP-Z0-9]{47}$/.test(addr),
  Ton: addr => /^[UE][Qf][a-zA-Z0-9_-]{46}$/.test(addr),
  Ripple: addr => /^r[a-zA-Z0-9]{24,34}$/.test(addr),
  Tron: addr => /^T[a-zA-Z0-9]{33}$/.test(addr),
  Cardano: addr => /^addr1[a-z0-9]{53,}$/.test(addr),
  QBTC: addr => /^qbtc1[a-z0-9]{38,}$/.test(addr),
}

/** Deterministic hex pubkey for QBTC (ML-DSA); deriveQbtcAddress only hashes bytes — no chain signing. */
const MOCK_MLDSA_PUBLIC_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

/**
 * Fixed test-vault root keys shared by the mock vault below AND the golden-vector
 * describe block further down. A valid (on-curve) compressed secp256k1 pubkey +
 * 32-byte chain code, so `derivePublicKey`'s BIP32 CKD math and the golden
 * reference derivation below operate on the exact same root.
 */
const MOCK_ECDSA_PUBLIC_KEY_HEX = '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc'
const MOCK_EDDSA_PUBLIC_KEY_HEX = 'b5d7a8e02f3c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e'
const MOCK_HEX_CHAIN_CODE = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

/** Base64 VaultContainer (unencrypted) wrapping a Vault protobuf that includes ML-DSA fields. */
function buildUnencryptedVultBase64(params: {
  name: string
  publicKeys: { ecdsa: string; eddsa: string }
  signers: string[]
  hexChainCode: string
  localPartyId: string
  publicKeyMldsa44: string
  keyShareMldsa: string
  ecdsaShare: string
  eddsaShare: string
}): string {
  const inner = create(VaultSchema, {
    name: params.name,
    publicKeyEcdsa: params.publicKeys.ecdsa,
    publicKeyEddsa: params.publicKeys.eddsa,
    signers: params.signers,
    hexChainCode: params.hexChainCode,
    localPartyId: params.localPartyId,
    resharePrefix: '',
    libType: LibType.GG20,
    publicKeyMldsa44: params.publicKeyMldsa44,
    keyShares: [
      create(Vault_KeyShareSchema, {
        publicKey: params.publicKeys.ecdsa,
        keyshare: params.ecdsaShare,
      }),
      create(Vault_KeyShareSchema, {
        publicKey: params.publicKeys.eddsa,
        keyshare: params.eddsaShare,
      }),
      create(Vault_KeyShareSchema, {
        publicKey: params.publicKeyMldsa44,
        keyshare: params.keyShareMldsa,
      }),
    ],
    chainPublicKeys: [],
  })
  const innerB64 = Buffer.from(toBinary(VaultSchema, inner)).toString('base64')
  const container = create(VaultContainerSchema, {
    version: 1n,
    vault: innerB64,
    isEncrypted: false,
  })
  return Buffer.from(toBinary(VaultContainerSchema, container)).toString('base64')
}

/** Read `coreVault` in tests (field is protected on vault classes). */
function coreVaultOf(vault: FastVault | SecureVault): CoreVault {
  return (vault as unknown as { coreVault: CoreVault }).coreVault
}

describe('Integration: Multi-Chain Address Derivation', () => {
  let sdk: Vultisig
  let vault: FastVault
  let memoryStorage: MemoryStorage
  let context: SdkContext

  beforeAll(async () => {
    // Create fresh storage
    memoryStorage = new MemoryStorage()

    // Create SDK context with all dependencies
    context = createSdkContext({
      storage: memoryStorage,
      serverEndpoints: {
        fastVault: 'https://api.vultisig.com/vault',
        messageRelay: 'https://api.vultisig.com/router',
      },
      defaultChains: ALL_CHAINS,
      defaultCurrency: 'USD',
    })

    // Initialize SDK with WASM
    sdk = new Vultisig({
      storage: memoryStorage,
      defaultChains: ALL_CHAINS,
    })

    await sdk.initialize()

    // Create a vault directly with mock data (no MPC keygen needed for address derivation)
    const now = Date.now()
    const mockVaultData: CoreVault = {
      name: 'Integration Test Vault',
      publicKeys: {
        // Real-ish looking public keys (proper format for address derivation)
        ecdsa: MOCK_ECDSA_PUBLIC_KEY_HEX,
        eddsa: MOCK_EDDSA_PUBLIC_KEY_HEX,
      },
      hexChainCode: MOCK_HEX_CHAIN_CODE,
      localPartyId: 'test-device',
      signers: ['test-device', 'Server-1'],
      keyShares: {
        ecdsa: 'mock_ecdsa_keyshare',
        eddsa: 'mock_eddsa_keyshare',
      },
      publicKeyMldsa: MOCK_MLDSA_PUBLIC_KEY_HEX,
      keyShareMldsa: 'mock_mldsa_keyshare',
      resharePrefix: '',
      libType: 'GG20',
      createdAt: now,
      isBackedUp: false,
      order: 0,
    } as CoreVault

    // Create mock VaultData with correct structure
    const vaultData = {
      // Identity (readonly fields)
      publicKeys: mockVaultData.publicKeys,
      hexChainCode: mockVaultData.hexChainCode,
      publicKeyMldsa: mockVaultData.publicKeyMldsa,
      keyShareMldsa: mockVaultData.keyShareMldsa,
      signers: mockVaultData.signers,
      localPartyId: mockVaultData.localPartyId,
      createdAt: now,
      libType: mockVaultData.libType,
      isEncrypted: false,
      type: 'fast' as const,
      // Metadata
      id: mockVaultData.publicKeys.ecdsa, // Use ECDSA public key as ID
      name: 'Integration Test Vault',
      isBackedUp: false,
      order: 0,
      lastModified: now,
      // User Preferences
      currency: 'usd',
      chains: ALL_CHAINS.map(c => c.toString()),
      tokens: {},
      // Vault file
      vultFileContent: '',
    }

    // Create FastSigningService with context dependencies
    const fastSigningService = new FastSigningService(context.serverManager, context.wasmProvider)

    // Create VaultContext from SdkContext
    const vaultContext = {
      storage: context.storage,
      config: context.config,
      serverManager: context.serverManager,
      passwordCache: context.passwordCache,
      wasmProvider: context.wasmProvider,
      pushNotificationService: context.pushNotificationService,
    }

    vault = FastVault.fromStorage(vaultData, fastSigningService, vaultContext)

    console.log('✅ SDK initialized and vault created with REAL WASM')
    console.log(`   Testing ${ALL_CHAINS.length} chains\n`)
  }, 60000) // Allow 60 seconds for WASM initialization

  afterAll(() => {
    sdk?.dispose()
    context.passwordCache.destroy()
  })

  /**
   * Legacy storage may omit `publicKeyMldsa` / `keyShareMldsa` on VaultData while the
   * unencrypted `.vult` payload still carries ML-DSA; fromStorage must not clobber
   * values already parsed in the constructor.
   */
  describe('Legacy storage: ML-DSA only in .vult file', () => {
    const legacyPublicKeys = {
      ecdsa: '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc',
      eddsa: 'b5d7a8e02f3c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
    }
    const legacyHexChainCode = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

    it('FastVault.fromStorage preserves constructor-parsed ML-DSA when VaultData omits them', async () => {
      const now = Date.now()
      const vultFileContent = buildUnencryptedVultBase64({
        name: 'Legacy Fast',
        publicKeys: legacyPublicKeys,
        signers: ['test-device', 'Server-1'],
        hexChainCode: legacyHexChainCode,
        localPartyId: 'test-device',
        publicKeyMldsa44: MOCK_MLDSA_PUBLIC_KEY_HEX,
        keyShareMldsa: 'mock_mldsa_keyshare',
        ecdsaShare: 'mock_ecdsa_keyshare',
        eddsaShare: 'mock_eddsa_keyshare',
      })

      const vaultData: VaultData = {
        publicKeys: legacyPublicKeys,
        hexChainCode: legacyHexChainCode,
        signers: ['test-device', 'Server-1'],
        localPartyId: 'test-device',
        createdAt: now,
        libType: 'GG20',
        isEncrypted: false,
        type: 'fast',
        id: legacyPublicKeys.ecdsa,
        name: 'Legacy Fast',
        isBackedUp: false,
        order: 0,
        lastModified: now,
        currency: 'usd',
        chains: [Chain.QBTC.toString()],
        tokens: {},
        vultFileContent,
      }

      const fastSigningService = new FastSigningService(context.serverManager, context.wasmProvider)
      const vaultContext = {
        storage: context.storage,
        config: context.config,
        serverManager: context.serverManager,
        passwordCache: context.passwordCache,
        wasmProvider: context.wasmProvider,
        pushNotificationService: context.pushNotificationService,
      }

      const restored = FastVault.fromStorage(vaultData, fastSigningService, vaultContext)

      const core = coreVaultOf(restored)
      expect(core.publicKeyMldsa).toBe(MOCK_MLDSA_PUBLIC_KEY_HEX)
      expect(core.keyShareMldsa).toBe('mock_mldsa_keyshare')

      const address = await restored.address(Chain.QBTC)
      expect(CHAIN_VALIDATORS.QBTC?.(address)).toBe(true)
    })

    it('SecureVault.fromStorage preserves constructor-parsed ML-DSA when VaultData omits them', async () => {
      const now = Date.now()
      const secureSigners = ['test-device-a', 'test-device-b']
      const vultFileContent = buildUnencryptedVultBase64({
        name: 'Legacy Secure',
        publicKeys: legacyPublicKeys,
        signers: secureSigners,
        hexChainCode: legacyHexChainCode,
        localPartyId: 'test-device-a',
        publicKeyMldsa44: MOCK_MLDSA_PUBLIC_KEY_HEX,
        keyShareMldsa: 'mock_mldsa_keyshare',
        ecdsaShare: 'mock_ecdsa_keyshare',
        eddsaShare: 'mock_eddsa_keyshare',
      })

      const vaultData: VaultData = {
        publicKeys: legacyPublicKeys,
        hexChainCode: legacyHexChainCode,
        signers: secureSigners,
        localPartyId: 'test-device-a',
        createdAt: now,
        libType: 'GG20',
        isEncrypted: false,
        type: 'secure',
        id: legacyPublicKeys.ecdsa,
        name: 'Legacy Secure',
        isBackedUp: false,
        order: 0,
        lastModified: now,
        currency: 'usd',
        chains: [Chain.QBTC.toString()],
        tokens: {},
        vultFileContent,
      }

      const vaultContext = {
        storage: context.storage,
        config: context.config,
        serverManager: context.serverManager,
        passwordCache: context.passwordCache,
        wasmProvider: context.wasmProvider,
        pushNotificationService: context.pushNotificationService,
      }

      const restored = SecureVault.fromStorage(vaultData, vaultContext)

      const core = coreVaultOf(restored)
      expect(core.publicKeyMldsa).toBe(MOCK_MLDSA_PUBLIC_KEY_HEX)
      expect(core.keyShareMldsa).toBe('mock_mldsa_keyshare')

      const address = await restored.address(Chain.QBTC)
      expect(CHAIN_VALIDATORS.QBTC?.(address)).toBe(true)
    })
  })

  /**
   * CRITICAL TEST: Verify EVERY chain can derive a valid address
   *
   * This test is parameterized to run once per chain, providing clear
   * visibility into which chains pass and which fail.
   */
  describe.each(ALL_CHAINS)('Chain: %s', chain => {
    it(`should derive a valid ${chain} address`, async () => {
      // Derive address using public API
      const address = await vault.address(chain)

      // Basic validations
      expect(address, `${chain} address should be defined`).toBeDefined()
      expect(typeof address, `${chain} address should be a string`).toBe('string')
      expect(address.length, `${chain} address should not be empty`).toBeGreaterThan(0)

      // Chain-specific validation
      const validator = CHAIN_VALIDATORS[chain]
      if (validator) {
        expect(validator(address), `${chain} address "${address}" should match expected format`).toBe(true)
      } else {
        // Fallback: at least check for reasonable length
        expect(address.length, `${chain} address should have reasonable length (20+ chars)`).toBeGreaterThanOrEqual(20)

        console.warn(`⚠️  No validator for ${chain}, only checked length. Address: ${address}`)
      }

      console.log(`✅ ${chain.padEnd(20)} → ${address}`)
    }, 30000) // 30 second timeout per chain

    it(`should cache ${chain} address permanently`, async () => {
      // First call
      const address1 = await vault.address(chain)

      // Second call - should return cached address
      const address2 = await vault.address(chain)

      expect(address1).toBe(address2)
    })
  })

  /**
   * Test EVM chain address consistency
   * All EVM chains should derive the SAME address (same public key)
   */
  describe('EVM Chain Family Consistency', () => {
    const evmChains = [
      Chain.Ethereum,
      Chain.Polygon,
      Chain.BSC,
      Chain.Avalanche,
      Chain.Arbitrum,
      Chain.Optimism,
      Chain.Base,
      Chain.Blast,
      Chain.Zksync,
      Chain.Mantle,
      Chain.CronosChain,
    ]

    it('should derive identical addresses for all EVM chains', async () => {
      const addresses = await Promise.all(
        evmChains.map(async chain => ({
          chain,
          address: await vault.address(chain),
        }))
      )

      // All addresses should be identical
      const firstAddress = addresses[0].address
      addresses.forEach(({ chain, address }) => {
        expect(address, `${chain} should have same address as Ethereum`).toBe(firstAddress)
      })

      console.log(`\n✅ All ${evmChains.length} EVM chains share address: ${firstAddress}`)
    })
  })

  /**
   * Test Cosmos chain address prefix correctness
   * Each Cosmos chain has a unique bech32 prefix
   */
  describe('Cosmos Chain Prefix Validation', () => {
    const cosmosPrefixes: Record<string, string> = {
      [Chain.Cosmos]: 'cosmos1',
      [Chain.THORChain]: 'thor1',
      [Chain.MayaChain]: 'maya1',
      [Chain.Osmosis]: 'osmo1',
      [Chain.Dydx]: 'dydx1',
      [Chain.Kujira]: 'kujira1',
      [Chain.Terra]: 'terra1',
      [Chain.TerraClassic]: 'terra1',
      [Chain.Noble]: 'noble1',
      [Chain.Akash]: 'akash1',
    }

    Object.entries(cosmosPrefixes).forEach(([chain, expectedPrefix]) => {
      it(`should derive ${chain} address with correct prefix "${expectedPrefix}"`, async () => {
        const address = await vault.address(chain as Chain)

        expect(address.startsWith(expectedPrefix), `${chain} address should start with "${expectedPrefix}"`).toBe(true)
      })
    })
  })

  /**
   * sdk#1539 - every assertion above this point is a format REGEX (or, for the
   * Cosmos block, a bech32 PREFIX). A derivation bug that produces a
   * well-formed-but-WRONG address - swapped coin type, wrong derivation path,
   * wrong hash function - passes every one of them, because a regex only knows
   * the SHAPE of an address, not its VALUE.
   *
   * This block pins the exact VALUE for one chain per family (UTXO / EVM /
   * Cosmos / EdDSA) against an INDEPENDENT reference re-derivation, not
   * against a value captured by running `vault.address()` once and pasting
   * the result (that would just fossilize whatever the SDK currently does,
   * bug included).
   *
   * The independent reference re-implements, using different libraries than
   * `packages/core/chain/publicKey/{getPublicKey,ecdsa/derivePublicKey,address/deriveAddress}.ts`:
   *  - the BIP32 public-key-only child derivation `derivePublicKey.ts` does via
   *    the `bip32` + `tiny-secp256k1` packages (same libraries, since they ARE
   *    the audited reference secp256k1/BIP32 implementation most JS wallets
   *    build on - not something the SDK authored), applied to the coin-specific
   *    path segments as WalletCore's own `CoinTypeExt.derivationPath` documents
   *    them (`getPublicKey.ts` strips the `'` hardened markers and derives
   *    every segment as a plain non-hardened index, since a public-only root
   *    key cannot do hardened CKD - verified directly against a running
   *    `CoinTypeExt.derivationPath()` call: bitcoin m/84'/0'/0'/0/0, ethereum
   *    m/44'/60'/0'/0/0, cosmos m/44'/118'/0'/0/0);
   *  - the per-chain address ENCODING via dedicated libraries instead of
   *    WalletCore's `AnyAddress`/`CoinTypeExt`: `bitcoinjs-lib`'s P2WPKH payment
   *    for Bitcoin, hand-rolled Keccak-256 + EIP-55 checksum for Ethereum,
   *    `@noble/hashes`' sha256/ripemd160 + `bech32` for the Cosmos-SDK
   *    `RIPEMD160(SHA256(pubkey))` address scheme, and `bs58` for Solana (an
   *    EdDSA chain - `getPublicKey.ts`'s eddsa branch returns the root eddsa
   *    pubkey unchanged with no HD derivation, so a Solana address is simply
   *    the base58 encoding of that raw pubkey).
   *
   * Mutation-verify (sdk#1539): temporarily swapping the Ethereum coin type for
   * Cosmos's in `getCoinType.ts` still produces a well-formed 0x-address that
   * passes the `Ethereum` regex above, but fails `toBe(expectedEthereumAddress)`
   * here - proving this block catches what the regex cannot.
   */
  describe('Golden address vectors (independent reference derivation, sdk#1539)', () => {
    const bip32 = BIP32Factory(ecc)
    const rootNode = bip32.fromPublicKey(
      Buffer.from(MOCK_ECDSA_PUBLIC_KEY_HEX, 'hex'),
      Buffer.from(MOCK_HEX_CHAIN_CODE, 'hex')
    )

    const deriveNonHardened = (path: number[]) => path.reduce((node, index) => node.derive(index), rootNode)

    const toChecksumEthAddress = (addressHex: string): string => {
      const lower = addressHex.toLowerCase()
      const hashHex = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex')
      return '0x' + [...lower].map((char, i) => (parseInt(hashHex[i], 16) >= 8 ? char.toUpperCase() : char)).join('')
    }

    it('derives the canonical Ethereum address (BIP32 m/44/60/0/0/0 + Keccak-256 + EIP-55)', async () => {
      const child = deriveNonHardened([44, 60, 0, 0, 0])
      const uncompressed = ecc.pointCompress(child.publicKey, false)
      const addressBytes = keccak_256(uncompressed.slice(1)).slice(-20)
      const expectedAddress = toChecksumEthAddress(Buffer.from(addressBytes).toString('hex'))

      const address = await vault.address(Chain.Ethereum)

      expect(address).toBe(expectedAddress)
    })

    it('derives the canonical Bitcoin native-segwit address (BIP32 m/84/0/0/0/0 + P2WPKH)', async () => {
      const child = deriveNonHardened([84, 0, 0, 0, 0])
      const expectedAddress = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(child.publicKey),
        network: bitcoin.networks.bitcoin,
      }).address

      const address = await vault.address(Chain.Bitcoin)

      expect(address).toBe(expectedAddress)
    })

    it('derives the canonical Cosmos address (BIP32 m/44/118/0/0/0 + RIPEMD160(SHA256) + bech32)', async () => {
      const child = deriveNonHardened([44, 118, 0, 0, 0])
      const hash160 = ripemd160(sha256(Buffer.from(child.publicKey)))
      const expectedAddress = bech32.encode('cosmos', bech32.toWords(hash160))

      const address = await vault.address(Chain.Cosmos)

      expect(address).toBe(expectedAddress)
    })

    it('derives the canonical Solana address (raw EdDSA pubkey, base58, no HD derivation)', async () => {
      const expectedAddress = bs58.encode(Buffer.from(MOCK_EDDSA_PUBLIC_KEY_HEX, 'hex'))

      const address = await vault.address(Chain.Solana)

      expect(address).toBe(expectedAddress)
    })
  })

  /**
   * Reproduce BCH bug: passing enum key 'BitcoinCash' instead of enum value 'Bitcoin-Cash'
   * BCH is the only chain where key !== value, so only BCH triggers this failure.
   * The SDK boundary validation (assertValidChain) now catches this early with a helpful message.
   */
  describe('BCH enum key mismatch', () => {
    it('should fail when passing "BitcoinCash" instead of Chain.BitcoinCash ("Bitcoin-Cash")', async () => {
      try {
        await vault.address('BitcoinCash' as Chain)
        expect.unreachable('should have thrown')
      } catch (error: any) {
        expect(error.message).toMatch(/Invalid chain: "BitcoinCash"/)
      }
    })
  })

  /**
   * Batch address derivation performance test
   */
  describe('Batch Derivation Performance', () => {
    it('should derive all chain addresses efficiently', async () => {
      const startTime = Date.now()

      // Derive addresses for all chains in parallel
      const results = await Promise.all(
        ALL_CHAINS.map(async chain => ({
          chain,
          address: await vault.address(chain),
        }))
      )

      const duration = Date.now() - startTime

      // Verify we got addresses for all chains
      expect(results.length).toBe(ALL_CHAINS.length)

      // All addresses should be defined
      results.forEach(({ chain, address }) => {
        expect(address, `${chain} should have an address`).toBeDefined()
        expect(address.length).toBeGreaterThan(0)
      })

      console.log(`\n⚡ Derived ${ALL_CHAINS.length} addresses in ${duration}ms`)
      console.log(`   Average: ${(duration / ALL_CHAINS.length).toFixed(2)}ms per chain`)

      // Should complete within reasonable time (10 seconds for 40+ chains)
      expect(duration).toBeLessThan(10000)
    }, 15000)
  })
})
