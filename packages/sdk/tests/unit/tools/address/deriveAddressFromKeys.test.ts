import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWalletCore, mockGetPublicKey, mockDeriveAddress } = vi.hoisted(() => ({
  mockGetWalletCore: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockDeriveAddress: vi.fn(),
}))

vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@vultisig/core-chain/publicKey/address/deriveAddress', () => ({
  deriveAddress: mockDeriveAddress,
}))

import { deriveAddressFromKeys } from '@/tools/address/deriveAddressFromKeys'

const mockWalletCore = { __mock: 'walletCore' }
const mockPublicKey = { __mock: 'publicKey' }

describe('deriveAddressFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
    mockDeriveAddress.mockReturnValue('0xabc123')
  })

  it('throws when neither ecdsa nor eddsa key', async () => {
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Ethereum,
        hexChainCode: '00',
      })
    ).rejects.toThrow('At least one public key (ecdsaPublicKey or eddsaPublicKey) is required')
  })

  it('throws when hexChainCode empty', async () => {
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Ethereum,
        ecdsaPublicKey: '02hex',
        hexChainCode: '',
      })
    ).rejects.toThrow('hexChainCode is required for address derivation')
  })

  it('when getWalletCore rejects, error message mentions WalletCore init', async () => {
    mockGetWalletCore.mockRejectedValueOnce(new Error('bootstrap failed'))
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Ethereum,
        ecdsaPublicKey: '02hex',
        hexChainCode: 'cafe',
      })
    ).rejects.toThrow(/Failed to initialize WalletCore for address derivation/)
  })

  it('when getPublicKey throws, error mentions chain name', async () => {
    mockGetPublicKey.mockImplementationOnce(() => {
      throw new Error('key derivation error')
    })
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Solana,
        ecdsaPublicKey: '02hex',
        hexChainCode: 'cafe',
      })
    ).rejects.toThrow(/Failed to derive public key for Solana:/)
  })

  it('when deriveAddress throws, error mentions chain', async () => {
    mockDeriveAddress.mockImplementationOnce(() => {
      throw new Error('address derivation error')
    })
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Bitcoin,
        ecdsaPublicKey: '02hex',
        hexChainCode: 'cafe',
      })
    ).rejects.toThrow(/Failed to derive address for Bitcoin:/)
  })

  it('returns chain and address on success (no chainPublicKeys — fallback path unchanged)', async () => {
    const address = 'bc1qdummy'
    mockDeriveAddress.mockReturnValueOnce(address)
    const result = await deriveAddressFromKeys({
      chain: Chain.Bitcoin,
      ecdsaPublicKey: '02hex',
      hexChainCode: 'cafe',
    })
    expect(result).toEqual({ chain: Chain.Bitcoin, address })
    expect(mockGetWalletCore).toHaveBeenCalledTimes(1)
    expect(mockGetPublicKey).toHaveBeenCalledWith({
      chain: Chain.Bitcoin,
      walletCore: mockWalletCore,
      hexChainCode: 'cafe',
      publicKeys: {
        ecdsa: '02hex',
        eddsa: '',
      },
      chainPublicKeys: undefined,
    })
    expect(mockDeriveAddress).toHaveBeenCalledWith({
      chain: Chain.Bitcoin,
      publicKey: mockPublicKey,
      walletCore: mockWalletCore,
    })
  })

  describe('chainPublicKeys — pre-derived hardened pubkey path', () => {
    // Fixture: known Terra hardened-derived pubkey from test seed
    // seed: "quick assist swamp smoke unknown grit cattle choose fabric crawl announce charge"
    // path: m/44'/330'/0'/0/0
    const terraHardenedPubkey = '03c7721fa4760e081f7ae3b192084467528603ebdf84ebf3d86addc86d5bcdc31b'
    const terraFundedAddress = 'terra10mtp3kjs9jh05cp288alz35308jmr6arjfr43r'

    it('uses chainPublicKeys[Terra] directly and returns funded address', async () => {
      mockDeriveAddress.mockReturnValueOnce(terraFundedAddress)
      const result = await deriveAddressFromKeys({
        chain: Chain.Terra,
        ecdsaPublicKey: 'root_pubkey_hex',
        hexChainCode: 'chain_code_hex',
        chainPublicKeys: { [Chain.Terra]: terraHardenedPubkey },
      })
      expect(result).toEqual({
        chain: Chain.Terra,
        address: terraFundedAddress,
      })
      // getPublicKey receives the chainPublicKeys map including the Terra alias
      expect(mockGetPublicKey).toHaveBeenCalledWith({
        chain: Chain.Terra,
        walletCore: mockWalletCore,
        hexChainCode: 'chain_code_hex',
        publicKeys: { ecdsa: 'root_pubkey_hex', eddsa: '' },
        chainPublicKeys: {
          [Chain.Terra]: terraHardenedPubkey,
          [Chain.TerraClassic]: terraHardenedPubkey,
        },
      })
    })

    it('Terra key auto-aliases to TerraClassic', async () => {
      mockDeriveAddress.mockReturnValueOnce(terraFundedAddress)
      await deriveAddressFromKeys({
        chain: Chain.TerraClassic,
        ecdsaPublicKey: 'root_pubkey_hex',
        hexChainCode: 'chain_code_hex',
        chainPublicKeys: { [Chain.Terra]: terraHardenedPubkey },
      })
      // TerraClassic should be present in the forwarded map even though only Terra was supplied
      expect(mockGetPublicKey).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: Chain.TerraClassic,
          chainPublicKeys: expect.objectContaining({
            [Chain.TerraClassic]: terraHardenedPubkey,
          }),
        })
      )
    })

    it('when TerraClassic key already present, no overwrite', async () => {
      const distinctClassicPubkey = '02aabbccdd'
      mockDeriveAddress.mockReturnValueOnce('terra1classic')
      await deriveAddressFromKeys({
        chain: Chain.TerraClassic,
        ecdsaPublicKey: 'root_pubkey_hex',
        hexChainCode: 'chain_code_hex',
        chainPublicKeys: {
          [Chain.Terra]: terraHardenedPubkey,
          [Chain.TerraClassic]: distinctClassicPubkey,
        },
      })
      // Pre-supplied TerraClassic key is preserved, not overwritten by alias
      expect(mockGetPublicKey).toHaveBeenCalledWith(
        expect.objectContaining({
          chainPublicKeys: expect.objectContaining({
            [Chain.TerraClassic]: distinctClassicPubkey,
          }),
        })
      )
    })

    it('chainPublicKeys for unrelated chain: map is NOT forwarded so BIP32 fallback runs', async () => {
      // Ethereum pubkey is present but Terra is not — Terra should fall back to BIP32 derivation.
      // We must not forward the partial map to getPublicKey because it would throw
      // "Chain public key not found" (it treats any non-empty map as authoritative).
      const ethOnlyKeys = { [Chain.Ethereum]: '02ethpubkey' }
      mockDeriveAddress.mockReturnValueOnce('terra1nonhardened')
      await deriveAddressFromKeys({
        chain: Chain.Terra,
        ecdsaPublicKey: 'root_pubkey_hex',
        hexChainCode: 'chain_code_hex',
        chainPublicKeys: ethOnlyKeys,
      })
      // chainPublicKeys must be undefined so the non-hardened BIP32 fallback runs
      expect(mockGetPublicKey).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: Chain.Terra,
          chainPublicKeys: undefined,
        })
      )
    })

    it('TerraClassic key reverse-aliases to Terra', async () => {
      // Caller supplies TerraClassic but queries Terra — reverse alias must kick in
      mockDeriveAddress.mockReturnValueOnce(terraFundedAddress)
      await deriveAddressFromKeys({
        chain: Chain.Terra,
        ecdsaPublicKey: 'root_pubkey_hex',
        hexChainCode: 'chain_code_hex',
        chainPublicKeys: { [Chain.TerraClassic]: terraHardenedPubkey },
      })
      expect(mockGetPublicKey).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: Chain.Terra,
          chainPublicKeys: expect.objectContaining({
            [Chain.Terra]: terraHardenedPubkey,
          }),
        })
      )
    })

    it('omitting chainPublicKeys passes undefined to getPublicKey (no regression)', async () => {
      await deriveAddressFromKeys({
        chain: Chain.Ethereum,
        ecdsaPublicKey: '02hex',
        hexChainCode: 'cafe',
      })
      expect(mockGetPublicKey).toHaveBeenCalledWith(expect.objectContaining({ chainPublicKeys: undefined }))
    })

    it('explicit empty chainPublicKeys entry throws instead of silently falling back', async () => {
      // Regression guard: an empty string is a caller error, not a "key absent" signal.
      // Before the fix, `if (!aliased[input.chain])` treated '' as falsy and fell back
      // to non-hardened BIP32 derivation, returning the wrong address silently.
      await expect(
        deriveAddressFromKeys({
          chain: Chain.Terra,
          ecdsaPublicKey: 'root_pubkey_hex',
          hexChainCode: 'chain_code_hex',
          chainPublicKeys: { [Chain.Terra]: '' },
        })
      ).rejects.toThrow(/Invalid chainPublicKeys entry for Terra: pubkey must be non-empty/)
      // getPublicKey must NOT have been called — we should have thrown before reaching it
      expect(mockGetPublicKey).not.toHaveBeenCalled()
    })

    it('whitespace-only chainPublicKeys entry also throws', async () => {
      await expect(
        deriveAddressFromKeys({
          chain: Chain.Terra,
          ecdsaPublicKey: 'root_pubkey_hex',
          hexChainCode: 'chain_code_hex',
          chainPublicKeys: { [Chain.Terra]: '   ' },
        })
      ).rejects.toThrow(/Invalid chainPublicKeys entry for Terra: pubkey must be non-empty/)
      expect(mockGetPublicKey).not.toHaveBeenCalled()
    })

    it('empty Terra key throws when deriving TerraClassic (alias-source presence check)', async () => {
      // Regression: before the fix, { Terra: "" } while requesting TerraClassic
      // bypassed the empty-value guard because the truthy alias check skipped
      // alias expansion, leaving TerraClassic absent, so the code returned
      // undefined and BIP32 fallback ran silently.
      await expect(
        deriveAddressFromKeys({
          chain: Chain.TerraClassic,
          ecdsaPublicKey: 'root_pubkey_hex',
          hexChainCode: 'chain_code_hex',
          chainPublicKeys: { [Chain.Terra]: '' },
        })
      ).rejects.toThrow(/Invalid chainPublicKeys entry for Terra: pubkey must be non-empty/)
      expect(mockGetPublicKey).not.toHaveBeenCalled()
    })

    it('empty TerraClassic key throws when deriving Terra (reverse alias-source presence check)', async () => {
      await expect(
        deriveAddressFromKeys({
          chain: Chain.Terra,
          ecdsaPublicKey: 'root_pubkey_hex',
          hexChainCode: 'chain_code_hex',
          chainPublicKeys: { [Chain.TerraClassic]: '' },
        })
      ).rejects.toThrow(/Invalid chainPublicKeys entry for TerraClassic: pubkey must be non-empty/)
      expect(mockGetPublicKey).not.toHaveBeenCalled()
    })

    // Cosmos-family chains (issue vultisig-sdk#613, mcp-ts#294 E2E discovery).
    // These chains use BIP44 coin_type 118 with HARDENED derivation
    // (m/44'/118'/0'/0/0), which cannot be re-walked from a pubkey alone — the
    // MPC root + chaincode path produces the wrong address. Callers (mcp-ts
    // execute_swap, agent-backend tool dispatch) MUST forward
    // chainPublicKeys.<Chain> for these to work; we pin the contract here.
    //
    // The pubkey/address fixtures below are from a real on-chain account
    // (cosmos1ky4k58aq…3xvy, account_number 2782851, 51 prior cosmoshub-4 txs),
    // verified against the live LCD: the on-chain registered pubkey matches
    // the chainPublicKeys.Cosmos value exactly. Same hardened key derives the
    // bech32 for every cosmos-prefix family chain (different hrp per chain).
    describe('cosmos-family chains', () => {
      const cosmosHardenedPubkey = '029588aa44a9e3576f0db42de62fa69a528c5c61757284622ae436b9646e6cd513'
      const cosmosFundedAddress = 'cosmos1ky4k58aq36yx6gvz34xcu2tzhhsvrewyxa3xvy'

      it('uses chainPublicKeys[Cosmos] directly and returns funded cosmoshub-4 address', async () => {
        mockDeriveAddress.mockReturnValueOnce(cosmosFundedAddress)
        const result = await deriveAddressFromKeys({
          chain: Chain.Cosmos,
          ecdsaPublicKey: 'root_pubkey_hex',
          hexChainCode: 'chain_code_hex',
          chainPublicKeys: { [Chain.Cosmos]: cosmosHardenedPubkey },
        })
        expect(result).toEqual({ chain: Chain.Cosmos, address: cosmosFundedAddress })
        expect(mockGetPublicKey).toHaveBeenCalledWith(
          expect.objectContaining({
            chain: Chain.Cosmos,
            chainPublicKeys: { [Chain.Cosmos]: cosmosHardenedPubkey },
          })
        )
      })

      it('forwards chainPublicKeys[Osmosis] for osmosis-1 derivation', async () => {
        const osmoHardenedPubkey = '029588aa44a9e3576f0db42de62fa69a528c5c61757284622ae436b9646e6cd513'
        const osmoAddress = 'osmo1ky4k58aq36yx6gvz34xcu2tzhhsvrewywxzk6k'
        mockDeriveAddress.mockReturnValueOnce(osmoAddress)
        await deriveAddressFromKeys({
          chain: Chain.Osmosis,
          ecdsaPublicKey: 'root_pubkey_hex',
          hexChainCode: 'chain_code_hex',
          chainPublicKeys: { [Chain.Osmosis]: osmoHardenedPubkey },
        })
        expect(mockGetPublicKey).toHaveBeenCalledWith(
          expect.objectContaining({
            chain: Chain.Osmosis,
            chainPublicKeys: { [Chain.Osmosis]: osmoHardenedPubkey },
          })
        )
      })

      it('forwards chainPublicKeys[Kujira] for kujira-1 derivation', async () => {
        const kujiHardenedPubkey = '029588aa44a9e3576f0db42de62fa69a528c5c61757284622ae436b9646e6cd513'
        const kujiAddress = 'kujira1ky4k58aq36yx6gvz34xcu2tzhhsvrewyh4n7pw'
        mockDeriveAddress.mockReturnValueOnce(kujiAddress)
        await deriveAddressFromKeys({
          chain: Chain.Kujira,
          ecdsaPublicKey: 'root_pubkey_hex',
          hexChainCode: 'chain_code_hex',
          chainPublicKeys: { [Chain.Kujira]: kujiHardenedPubkey },
        })
        expect(mockGetPublicKey).toHaveBeenCalledWith(
          expect.objectContaining({
            chain: Chain.Kujira,
            chainPublicKeys: { [Chain.Kujira]: kujiHardenedPubkey },
          })
        )
      })

      it('Cosmos request with only Osmosis key supplied: map is NOT forwarded, BIP32 fallback runs', async () => {
        // Each cosmos chain is its own entry in chainPublicKeys (unlike Terra↔TerraClassic
        // which share coin_type 330). Cosmos↔Osmosis do NOT alias; a partial map for
        // a sibling chain must not bleed into another chain's derivation.
        mockDeriveAddress.mockReturnValueOnce('cosmos1bip32fallback')
        await deriveAddressFromKeys({
          chain: Chain.Cosmos,
          ecdsaPublicKey: 'root_pubkey_hex',
          hexChainCode: 'chain_code_hex',
          chainPublicKeys: { [Chain.Osmosis]: '029588aa44a9e3576f0db42de62fa69a528c5c61757284622ae436b9646e6cd513' },
        })
        expect(mockGetPublicKey).toHaveBeenCalledWith(
          expect.objectContaining({ chain: Chain.Cosmos, chainPublicKeys: undefined })
        )
      })
    })
  })
})
