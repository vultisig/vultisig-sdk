/**
 * Integration Tests: Master Key Derivation
 *
 * Tests key derivation from seedphrase with REAL WalletCore WASM.
 * Verifies ECDSA and EdDSA key derivation matches expected behavior.
 *
 * NOTE: Integration setup (WASM & crypto polyfills) loaded via vitest.config.ts
 */

import { Chain } from '@vultisig/core-chain/Chain'
import { beforeAll, describe, expect, it } from 'vitest'

import { createSdkContext, type SdkContext } from '../../../src/context/SdkContextBuilder'
import { MasterKeyDeriver } from '../../../src/seedphrase/MasterKeyDeriver'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'

// Standard BIP39 test mnemonic
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('Master Key Derivation (Real WASM)', () => {
  let context: SdkContext
  let deriver: MasterKeyDeriver

  beforeAll(async () => {
    // Create SDK context with real WASM
    context = await createSdkContext({
      storage: new MemoryStorage(),
    })
    deriver = new MasterKeyDeriver(context.wasmProvider)

    // Pre-initialize WASM
    await context.wasmProvider.getWalletCore()
  })

  describe('deriveMasterKeys', () => {
    it('should derive both ECDSA and EdDSA master keys', async () => {
      const result = await deriver.deriveMasterKeys(TEST_MNEMONIC)

      expect(result).toHaveProperty('ecdsaPrivateKeyHex')
      expect(result).toHaveProperty('eddsaPrivateKeyHex')
      expect(result).toHaveProperty('chainCodeHex')
    })

    it('should return valid hex strings for private keys', async () => {
      const result = await deriver.deriveMasterKeys(TEST_MNEMONIC)

      // Private keys are 32 bytes = 64 hex chars
      expect(result.ecdsaPrivateKeyHex).toMatch(/^[a-f0-9]{64}$/i)
      expect(result.eddsaPrivateKeyHex).toMatch(/^[a-f0-9]{64}$/i)
      // Chain code may be empty (actual chain code comes from DKLS result)
      expect(typeof result.chainCodeHex).toBe('string')
    })

    it('should produce deterministic output for same mnemonic', async () => {
      const result1 = await deriver.deriveMasterKeys(TEST_MNEMONIC)
      const result2 = await deriver.deriveMasterKeys(TEST_MNEMONIC)

      expect(result1.ecdsaPrivateKeyHex).toBe(result2.ecdsaPrivateKeyHex)
      expect(result1.eddsaPrivateKeyHex).toBe(result2.eddsaPrivateKeyHex)
    })

    it('should produce different keys for different mnemonics', async () => {
      const result1 = await deriver.deriveMasterKeys(TEST_MNEMONIC)
      const otherMnemonic = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'
      const result2 = await deriver.deriveMasterKeys(otherMnemonic)

      expect(result1.ecdsaPrivateKeyHex).not.toBe(result2.ecdsaPrivateKeyHex)
      expect(result1.eddsaPrivateKeyHex).not.toBe(result2.eddsaPrivateKeyHex)
    })

    it('should normalize mnemonic input', async () => {
      // With extra whitespace and mixed case
      const messyMnemonic =
        '  ABANDON   abandon   Abandon   abandon   ABANDON   abandon   abandon   abandon   abandon   abandon   abandon   ABOUT  '
      const result = await deriver.deriveMasterKeys(messyMnemonic)
      const cleanResult = await deriver.deriveMasterKeys(TEST_MNEMONIC)

      expect(result.ecdsaPrivateKeyHex).toBe(cleanResult.ecdsaPrivateKeyHex)
    })

    it('should apply Ed25519 scalar transformation to EdDSA key', async () => {
      const result = await deriver.deriveMasterKeys(TEST_MNEMONIC)

      // The EdDSA key should be transformed via clampThenUniformScalar
      // which involves SHA-512 hash + clamping + mod L reduction
      // After mod L reduction, specific bit patterns are not guaranteed
      // We just verify it's a valid 32-byte value different from ECDSA key
      const eddsaBytes = Buffer.from(result.eddsaPrivateKeyHex, 'hex')
      expect(eddsaBytes.length).toBe(32)
      expect(result.eddsaPrivateKeyHex).not.toBe(result.ecdsaPrivateKeyHex)
    })
  })

  describe('deriveChainKey', () => {
    it('should derive key for Bitcoin (ECDSA chain)', async () => {
      const result = await deriver.deriveChainKey(TEST_MNEMONIC, Chain.Bitcoin, false)

      expect(result).toHaveProperty('privateKeyHex')
      expect(result).toHaveProperty('publicKeyHex')
      expect(result.privateKeyHex).toMatch(/^[a-f0-9]{64}$/i)
    })

    it('should derive key for Ethereum (ECDSA chain)', async () => {
      const result = await deriver.deriveChainKey(TEST_MNEMONIC, Chain.Ethereum, false)

      expect(result).toHaveProperty('privateKeyHex')
      expect(result).toHaveProperty('publicKeyHex')
    })

    it('should derive key for Solana (EdDSA chain)', async () => {
      const result = await deriver.deriveChainKey(TEST_MNEMONIC, Chain.Solana, true)

      expect(result).toHaveProperty('privateKeyHex')
      expect(result).toHaveProperty('publicKeyHex')
    })

    it('should produce different keys for different chains', async () => {
      const btcKey = await deriver.deriveChainKey(TEST_MNEMONIC, Chain.Bitcoin, false)
      const ethKey = await deriver.deriveChainKey(TEST_MNEMONIC, Chain.Ethereum, false)
      const solKey = await deriver.deriveChainKey(TEST_MNEMONIC, Chain.Solana, true)

      // All keys should be different
      expect(btcKey.privateKeyHex).not.toBe(ethKey.privateKeyHex)
      expect(btcKey.privateKeyHex).not.toBe(solKey.privateKeyHex)
      expect(ethKey.privateKeyHex).not.toBe(solKey.privateKeyHex)
    })

    it('should produce deterministic keys for same chain', async () => {
      const result1 = await deriver.deriveChainKey(TEST_MNEMONIC, Chain.Bitcoin, false)
      const result2 = await deriver.deriveChainKey(TEST_MNEMONIC, Chain.Bitcoin, false)

      expect(result1.privateKeyHex).toBe(result2.privateKeyHex)
      expect(result1.publicKeyHex).toBe(result2.publicKeyHex)
    })
  })

  describe('deriveAddress', () => {
    it('should derive valid Bitcoin address', async () => {
      const address = await deriver.deriveAddress(TEST_MNEMONIC, Chain.Bitcoin)

      // Bitcoin native segwit address starts with bc1
      expect(address).toMatch(/^bc1[a-z0-9]{39,59}$/)
    })

    it('should derive valid Ethereum address', async () => {
      const address = await deriver.deriveAddress(TEST_MNEMONIC, Chain.Ethereum)

      // Ethereum address is 0x + 40 hex chars
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should derive valid Solana address', async () => {
      const address = await deriver.deriveAddress(TEST_MNEMONIC, Chain.Solana)

      // Solana address is base58 encoded
      expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    })

    it('should derive valid Cosmos address', async () => {
      const address = await deriver.deriveAddress(TEST_MNEMONIC, Chain.Cosmos)

      // Cosmos address starts with cosmos1
      expect(address).toMatch(/^cosmos1[a-z0-9]{38,}$/)
    })

    // Addresses a vault imported from TEST_MNEMONIC holds. Maya shares
    // THORChain's coin type and Bittensor Polkadot's, so WalletCore's own
    // per-coin address is wrong for both.
    it.each([
      [Chain.MayaChain, 'maya1gm00vwsfcp48enm4uv9e5dhm37jtd0ye2fs0sl'],
      [Chain.Bittensor, '5FHrJZLfgv3Ej8rrPbZpwjQJyV9kPwHSCUv7UhjBTv3BCHcc'],
      [Chain.BitcoinCash, 'qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6'],
    ])('should derive the vault address on %s', async (chain, expected) => {
      await expect(deriver.deriveAddress(TEST_MNEMONIC, chain)).resolves.toBe(expected)
    })

    it('should derive deterministic addresses', async () => {
      const address1 = await deriver.deriveAddress(TEST_MNEMONIC, Chain.Bitcoin)
      const address2 = await deriver.deriveAddress(TEST_MNEMONIC, Chain.Bitcoin)

      expect(address1).toBe(address2)
    })

    it('should derive known address for test mnemonic', async () => {
      // Known Ethereum address for the standard test mnemonic
      // "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
      const address = await deriver.deriveAddress(TEST_MNEMONIC, Chain.Ethereum)

      // This is the expected Ethereum address for this mnemonic with default derivation path
      // Note: The exact address depends on derivation path used by WalletCore
      expect(address).toBeTruthy()
      expect(address.startsWith('0x')).toBe(true)
    })
  })

  // One all-zero-entropy mnemonic per BIP39 length (the 18-word one is the
  // official BIP39 test vector). Expected values come from a separate
  // BIP39 + BIP32 + SLIP-10 derivation, not from WalletCore.
  describe('every BIP39 mnemonic length', () => {
    it.each([
      {
        wordCount: 12,
        mnemonic: TEST_MNEMONIC,
        ecdsaPrivateKeyHex: '1837c1be8e2995ec11cda2b066151be2cfb48adf9e47b151d46adab3a21cdf67',
        eddsaPrivateKeyHex: '1f303fc1a855ef1f4f26907b6c8f948fb4c29777bfdac547fd1b48df39714405',
        ethereum: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
        bitcoin: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
        solana: 'GjJyeC1r2RgkuoCWMyPYkCWSGSGLcz266EaAkLA27AhL',
        solanaPhantom: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
      },
      {
        wordCount: 15,
        mnemonic: `${'abandon '.repeat(14)}address`,
        ecdsaPrivateKeyHex: '3d2a6436762b3881d7df4f1effe63687a96811c9cd6921d677b2db15a3a99144',
        eddsaPrivateKeyHex: 'af12123f6a6fcfe7689fd4d35fad2651822bfd8e5bbc85c73f3b426ca98c7903',
        ethereum: '0x54bE88525B024a20229Fe7f6F62DC0884e4aAA0a',
        bitcoin: 'bc1q0n3pv7rlnm59gtwg3reqa7td8pjxtynwszlskj',
        solana: '3KSMevKt69PPrko4SM8oyCfn2cFDNeQ7JrP6PLW1JQpu',
        solanaPhantom: '5fXP2MmNT8H2LR61p2Sq1wY6Le4G65EGhEdjeTNmCt92',
      },
      {
        wordCount: 18,
        mnemonic: `${'abandon '.repeat(17)}agent`,
        ecdsaPrivateKeyHex: '673dd13b7c50798fa354fe99071af01ee487dc6e3a76101fa562873b0766918f',
        eddsaPrivateKeyHex: 'f59c684dc82f31774cd39f9ec69b7b17ffabc063d1cb3af582853421fe91f20d',
        ethereum: '0x197A1bEE163923815Ba58EaD0F14B3Fcd8C5926d',
        bitcoin: 'bc1qvckqrk6ad7fu9fkj2xeknssjldncap3csvnck0',
        solana: 'GwCJBBYBomRCQTRPGibr2u3J5wg56CijBoD2KtzaV5gd',
        solanaPhantom: '3KmfxwN9AK6zGoH8AmwTSDJVuNHUue6w2ZLqnhp782kR',
      },
      {
        wordCount: 21,
        mnemonic: `${'abandon '.repeat(20)}admit`,
        ecdsaPrivateKeyHex: 'af43564498ec09485d027cfe5f38318bae230647b530cac57246b7972cfaf77a',
        eddsaPrivateKeyHex: '3cdbed9f16d62bfe5f39cca3d8d60fd926755d69f0646550d856c5355a964e0b',
        ethereum: '0x15cc2210a0AFbb1A2d80Dd3D585aA94eBa6c10E0',
        bitcoin: 'bc1qvw2xfp7yzhuc3gg9jhkmm2vkc2nd75fuzy8t2v',
        solana: '9emhnP2aAxZ8oGVNE3RoyE3jdSX3ecbn9EGGBcbZNeqb',
        solanaPhantom: '2C43p6zuakYJwLrScwz1wZqv1bebyw8XLn6YQKroU5Gk',
      },
      {
        wordCount: 24,
        mnemonic: `${'abandon '.repeat(23)}art`,
        ecdsaPrivateKeyHex: '235b34cd7c9f6d7e4595ffe9ae4b1cb5606df8aca2b527d20a07c8f56b2342f4',
        eddsaPrivateKeyHex: '8c9368ed6b39a0a9e87ecfb0b53a8726342178a6182e5c2e3f9e4f0c31c1e608',
        ethereum: '0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb',
        bitcoin: 'bc1qzmtrqsfuaf6l6kkcsseumq26ukaphfj9skkug6',
        solana: '4BZp4ci5rhNYqbayj1uppeTas1osK2Q4b74x7UENC5Hd',
        solanaPhantom: '3Cy3YNTFywCmxoxt8n7UH6hg6dLo5uACowX3CFceaSnx',
      },
    ])(
      'should derive the imported keys and addresses from a $wordCount-word mnemonic',
      async ({ mnemonic, ecdsaPrivateKeyHex, eddsaPrivateKeyHex, ethereum, bitcoin, solana, solanaPhantom }) => {
        const masterKeys = await deriver.deriveMasterKeys(mnemonic)

        expect(masterKeys.ecdsaPrivateKeyHex).toBe(ecdsaPrivateKeyHex)
        expect(masterKeys.eddsaPrivateKeyHex).toBe(eddsaPrivateKeyHex)
        await expect(deriver.deriveAddress(mnemonic, Chain.Ethereum)).resolves.toBe(ethereum)
        await expect(deriver.deriveAddress(mnemonic, Chain.Bitcoin)).resolves.toBe(bitcoin)
        await expect(deriver.deriveAddress(mnemonic, Chain.Solana)).resolves.toBe(solana)
        await expect(deriver.deriveSolanaAddressWithPhantomPath(mnemonic)).resolves.toBe(solanaPhantom)
      }
    )
  })
})
